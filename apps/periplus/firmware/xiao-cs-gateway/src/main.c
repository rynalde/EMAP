/*
 * xiao-cs-gateway — Bluetooth Channel Sounding gateway for periplus.
 *
 * Based on the nRF Connect SDK sample
 * nrf/samples/bluetooth/channel_sounding/ras_initiator.
 *
 * Flow:
 *   boot -> scan for tags advertising our manufacturer UID -> connect to one ->
 *   act as CS Initiator and RAS client -> emit one JSON line per ranging result
 *   over USB serial -> disconnect -> move to the next tag -> repeat.
 *
 * Transport is deliberately the one the T-Echo gateway already uses: exactly
 * one JSON object per line over USB serial, consumed by the same bridge. A
 * ranging result is a relayed reading like any other — it just carries
 * distance_m where a GPS tag carries lat/lng. See docs/packet-format.md.
 *
 * Board: xiao_nrf54l15/nrf54l15/cpuapp
 */

#include <math.h>
#include <stdlib.h>
#include <zephyr/kernel.h>
#include <zephyr/types.h>
#include <zephyr/sys/byteorder.h>
#include <zephyr/bluetooth/bluetooth.h>
#include <zephyr/bluetooth/cs.h>
#include <zephyr/bluetooth/gatt.h>
#include <zephyr/bluetooth/conn.h>
#include <bluetooth/services/ras.h>
#include <bluetooth/gatt_dm.h>
#include <bluetooth/cs_de.h>

#include <zephyr/logging/log.h>
LOG_MODULE_REGISTER(cs_gateway, LOG_LEVEL_INF);

#define CS_CONFIG_ID 0
#define CS_CONFIG_MODE BT_CONN_LE_CS_MAIN_MODE_2_SUB_MODE_1

#define NUM_MODE_0_STEPS       3
#define PROCEDURE_COUNTER_NONE (-1)
#define DE_SLIDING_WINDOW_SIZE (9)
#define MAX_AP                 (CONFIG_BT_RAS_MAX_ANTENNA_PATHS)

#define LOCAL_PROCEDURE_MEM                                                                        \
	((BT_RAS_MAX_STEPS_PER_PROCEDURE * sizeof(struct bt_le_cs_subevent_step)) +                \
	 (BT_RAS_MAX_STEPS_PER_PROCEDURE * BT_RAS_MAX_STEP_DATA_LEN))

#define CHANNEL_INDEX_OFFSET (2)
#define TONE_QI_OK_TONE_COUNT_THRESHOLD (15)

/* Must match the tag: [0..1] company ID, [2] payload version, [3..10] UID. */
#define TAG_ADV_COMPANY_ID 0xFFFF
#define TAG_ADV_PROTO_VER  0x01
#define TAG_UID_LEN        8
#define TAG_UID_STR_LEN    (TAG_UID_LEN * 2 + 1)
#define TAG_MFG_DATA_LEN   (3 + TAG_UID_LEN)

/* How many tags this gateway will track at once. Small and fixed: this is a
 * round-robin scan list, not a database.
 */
#define MAX_TAGS 8

/* A tag not heard from for this long is dropped from the rotation, so a tag
 * that is switched off stops costing connection attempts.
 */
#define TAG_STALE_MS (60 * 1000)

/* Every wait in the ranging sequence is bounded by this. The upstream sample
 * uses K_FOREVER throughout, which is correct for a one-shot demo against a
 * single peer and fatal here: one tag that stops responding mid-handshake would
 * park the gateway forever and every other tag would go unranged.
 */
#define STEP_TIMEOUT K_SECONDS(10)

/* How long to range one tag before disconnecting and moving to the next. */
#define RANGING_DWELL_MS CONFIG_CS_GATEWAY_RANGING_DWELL_MS

/* How long to scan for tags before servicing the rotation. */
#define SCAN_WINDOW_MS CONFIG_CS_GATEWAY_SCAN_WINDOW_MS

static K_SEM_DEFINE(sem_remote_capabilities_obtained, 0, 1);
static K_SEM_DEFINE(sem_config_created, 0, 1);
static K_SEM_DEFINE(sem_cs_security_enabled, 0, 1);
static K_SEM_DEFINE(sem_connected, 0, 1);
static K_SEM_DEFINE(sem_disconnected, 0, 1);
static K_SEM_DEFINE(sem_discovery_done, 0, 1);
static K_SEM_DEFINE(sem_mtu_exchange_done, 0, 1);
static K_SEM_DEFINE(sem_security, 0, 1);
static K_SEM_DEFINE(sem_ras_features, 0, 1);
static K_SEM_DEFINE(sem_local_steps, 1, 1);
static K_SEM_DEFINE(sem_distance_estimate_updated, 0, 1);

static K_MUTEX_DEFINE(distance_estimate_buffer_mutex);
static K_MUTEX_DEFINE(tags_mutex);

static struct bt_conn *connection;
NET_BUF_SIMPLE_DEFINE_STATIC(latest_local_steps, LOCAL_PROCEDURE_MEM);
NET_BUF_SIMPLE_DEFINE_STATIC(latest_peer_steps, BT_RAS_PROCEDURE_MEM);
static int32_t most_recent_local_ranging_counter = PROCEDURE_COUNTER_NONE;
static int32_t dropped_ranging_counter = PROCEDURE_COUNTER_NONE;
static uint32_t ras_feature_bits;
static struct bt_conn_le_cs_config cs_config;

static uint16_t m_n_iqs[CONFIG_BT_RAS_MAX_ANTENNA_PATHS][CS_DE_NUM_CHANNELS];
static cs_de_report_t m_cs_de_report;

/* The tag currently being ranged. Its UID is captured from the advertisement at
 * scan time, because once connected there is nothing on the link that carries
 * it — the BLE address is randomised and is not an identity.
 */
static char current_tag_uid[TAG_UID_STR_LEN];
static int8_t current_tag_rssi;

struct tag_entry {
	bt_addr_le_t addr;
	char uid[TAG_UID_STR_LEN];
	int8_t rssi;
	int64_t last_seen_ms;
	bool in_use;
};

static struct tag_entry tags[MAX_TAGS];
/* Round-robin cursor, so one tag close to the gateway cannot monopolise it. */
static uint8_t rotation_cursor;

struct distance_estimate_buffer {
	cs_de_dist_estimates_t estimates[DE_SLIDING_WINDOW_SIZE];
	uint8_t num_valid;
	uint8_t index;
};

static struct distance_estimate_buffer distance_estimate_buffers[MAX_AP];

/* ------------------------------------------------------------------------- */
/* Upstream reporting                                                         */
/* ------------------------------------------------------------------------- */

/* Emit exactly one JSON object per line, matching the T-Echo gateway's format:
 * the tag's own reading nested under `payload`, wrapped in an envelope naming
 * the gateway that heard it.
 *
 * `valid` false means the ranging attempt produced no usable estimate. The
 * distance is then reported as null rather than as a stale or guessed number:
 * a fabricated distance is indistinguishable from a measured one once it is in
 * the database. This mirrors the GPS tag's rule for lat/lng, and the database
 * enforces it too (a 'failed' reading cannot carry a distance).
 */
static void report_ranging(const char *uid, bool valid, float distance_m, bool tone_quality_ok,
			   int8_t rssi)
{
	/* Same vocabulary a GPS device uses in `status`: the field says what the
	 * measurement is worth, whatever kind of measurement it is.
	 */
	const char *status;

	if (!valid) {
		status = "failed";
	} else if (tone_quality_ok) {
		status = "ok";
	} else {
		status = "poor";
	}

	printk("{\"device_id\":\"" CONFIG_CS_GATEWAY_ID "\","
	       "\"fw\":\"" CONFIG_CS_GATEWAY_FW_VERSION "\","
	       "\"received_at_ms\":%lld,"
	       "\"payload\":{"
	       "\"device_id\":\"%s\",",
	       k_uptime_get(), uid);

	if (valid) {
		/* Two decimals: CS is a centimetre-scale technique, and more
		 * digits would imply precision the measurement does not have.
		 */
		printk("\"distance_m\":%.2f,", (double)distance_m);
	} else {
		printk("\"distance_m\":null,");
	}

	printk("\"status\":\"%s\",\"rssi\":%d}}\n", status, rssi);
}

/* The gateway's own reading, emitted whether or not any tag is in range.
 *
 * Carries no `payload`, which is what tells the bridge the line is about the
 * gateway itself. This gateway has no GNSS, so it reports no position at all
 * rather than a placeholder — status "no_gps" says why. A gateway hearing no
 * tags is a normal state, not a fault, and it still needs to say it is alive.
 */
static void report_status(void)
{
	int active = 0;

	k_mutex_lock(&tags_mutex, K_FOREVER);
	for (int i = 0; i < MAX_TAGS; i++) {
		if (tags[i].in_use) {
			active++;
		}
	}
	k_mutex_unlock(&tags_mutex);

	printk("{\"device_id\":\"" CONFIG_CS_GATEWAY_ID "\","
	       "\"fw\":\"" CONFIG_CS_GATEWAY_FW_VERSION "\","
	       "\"status\":\"no_gps\","
	       "\"lat\":null,\"lng\":null,"
	       "\"sats\":0,"
	       "\"uptime_ms\":%lld,"
	       "\"tags_in_range\":%d}\n",
	       k_uptime_get(), active);
}

/* ------------------------------------------------------------------------- */
/* Tag table                                                                  */
/* ------------------------------------------------------------------------- */

static void tag_seen(const bt_addr_le_t *addr, const char *uid, int8_t rssi)
{
	int64_t now = k_uptime_get();
	int free_slot = -1;

	k_mutex_lock(&tags_mutex, K_FOREVER);

	for (int i = 0; i < MAX_TAGS; i++) {
		if (tags[i].in_use && strcmp(tags[i].uid, uid) == 0) {
			/* Match on UID, not address: the tag's BLE address
			 * randomises, so addressing it as an identity would make
			 * one tag look like an endless stream of new ones.
			 */
			bt_addr_le_copy(&tags[i].addr, addr);
			tags[i].rssi = rssi;
			tags[i].last_seen_ms = now;
			k_mutex_unlock(&tags_mutex);
			return;
		}
		if (!tags[i].in_use && free_slot < 0) {
			free_slot = i;
		}
	}

	if (free_slot < 0) {
		/* Full. Dropping the newcomer keeps the rotation stable rather
		 * than evicting a tag that is actively being ranged.
		 */
		k_mutex_unlock(&tags_mutex);
		LOG_WRN("Tag table full, ignoring uid=%s", uid);
		return;
	}

	bt_addr_le_copy(&tags[free_slot].addr, addr);
	strncpy(tags[free_slot].uid, uid, TAG_UID_STR_LEN - 1);
	tags[free_slot].uid[TAG_UID_STR_LEN - 1] = '\0';
	tags[free_slot].rssi = rssi;
	tags[free_slot].last_seen_ms = now;
	tags[free_slot].in_use = true;

	k_mutex_unlock(&tags_mutex);

	LOG_INF("New tag uid=%s rssi=%d", uid, rssi);
}

/* Pick the next tag to range, oldest-cursor-first, skipping stale entries. */
static bool tag_next(struct tag_entry *out)
{
	bool found = false;
	int64_t now = k_uptime_get();

	k_mutex_lock(&tags_mutex, K_FOREVER);

	for (int n = 0; n < MAX_TAGS; n++) {
		uint8_t i = (rotation_cursor + n) % MAX_TAGS;

		if (!tags[i].in_use) {
			continue;
		}

		if (now - tags[i].last_seen_ms > TAG_STALE_MS) {
			LOG_INF("Tag uid=%s went quiet, dropping from rotation", tags[i].uid);
			tags[i].in_use = false;
			continue;
		}

		*out = tags[i];
		rotation_cursor = (i + 1) % MAX_TAGS;
		found = true;
		break;
	}

	k_mutex_unlock(&tags_mutex);

	return found;
}

/* ------------------------------------------------------------------------- */
/* Distance estimation (unchanged from the upstream sample)                   */
/* ------------------------------------------------------------------------- */

static void store_distance_estimates_in_buffer(cs_de_dist_estimates_t *p_estimates,
					       struct distance_estimate_buffer *buffer)
{
	k_mutex_lock(&distance_estimate_buffer_mutex, K_FOREVER);

	memcpy(&buffer->estimates[buffer->index], p_estimates, sizeof(cs_de_dist_estimates_t));

	buffer->index = (buffer->index + 1) % DE_SLIDING_WINDOW_SIZE;

	if (buffer->num_valid < DE_SLIDING_WINDOW_SIZE) {
		buffer->num_valid++;
	}

	k_mutex_unlock(&distance_estimate_buffer_mutex);
}

static void distance_buffers_reset(void)
{
	k_mutex_lock(&distance_estimate_buffer_mutex, K_FOREVER);
	memset(distance_estimate_buffers, 0, sizeof(distance_estimate_buffers));
	k_mutex_unlock(&distance_estimate_buffer_mutex);
}

static int float_cmp(const void *a, const void *b)
{
	float fa = *(const float *)a;
	float fb = *(const float *)b;

	return (fa > fb) - (fa < fb);
}

static float median_inplace(int count, float *values)
{
	if (count == 0) {
		return NAN;
	}

	qsort(values, count, sizeof(float), float_cmp);

	if (count % 2 == 0) {
		return (values[count / 2] + values[count / 2 - 1]) / 2;
	}

	return values[count / 2];
}

/* Median over a sliding window rather than the latest single estimate: raw CS
 * estimates are noisy, and a median rejects the occasional wild outlier that a
 * mean would smear across every subsequent report.
 */
static cs_de_dist_estimates_t get_distance(uint8_t ap)
{
	cs_de_dist_estimates_t averaged_result = {};
	uint8_t num_ifft = 0;
	uint8_t num_phase_slope = 0;
	uint8_t num_rtt = 0;

	static float temp_ifft[DE_SLIDING_WINDOW_SIZE];
	static float temp_phase_slope[DE_SLIDING_WINDOW_SIZE];
	static float temp_rtt[DE_SLIDING_WINDOW_SIZE];

	struct distance_estimate_buffer *buffer = &distance_estimate_buffers[ap];

	k_mutex_lock(&distance_estimate_buffer_mutex, K_FOREVER);

	for (uint8_t i = 0; i < buffer->num_valid; i++) {
		if (isfinite(buffer->estimates[i].ifft)) {
			temp_ifft[num_ifft] = buffer->estimates[i].ifft;
			num_ifft++;
		}
		if (isfinite(buffer->estimates[i].phase_slope)) {
			temp_phase_slope[num_phase_slope] = buffer->estimates[i].phase_slope;
			num_phase_slope++;
		}
		if (isfinite(buffer->estimates[i].rtt)) {
			temp_rtt[num_rtt] = buffer->estimates[i].rtt;
			num_rtt++;
		}
	}

	k_mutex_unlock(&distance_estimate_buffer_mutex);

	averaged_result.ifft = median_inplace(num_ifft, temp_ifft);
	averaged_result.phase_slope = median_inplace(num_phase_slope, temp_phase_slope);
	averaged_result.rtt = median_inplace(num_rtt, temp_rtt);

	return averaged_result;
}

static bool m_is_tone_quality_ok(uint16_t num_iqs[CS_DE_NUM_CHANNELS], uint8_t channel_map[10])
{
	uint8_t ok_tones_count = 0;

	for (uint8_t i = 0; i < CS_DE_NUM_CHANNELS; ++i) {
		if (BT_LE_CS_CHANNEL_BIT_GET(channel_map, i + CHANNEL_INDEX_OFFSET) &&
		    num_iqs[i] >= 1) {
			ok_tones_count += 1;
		}
	}

	return (ok_tones_count >= TONE_QI_OK_TONE_COUNT_THRESHOLD);
}

static void cumulate_mean(float *avg, float new_value, uint16_t *N)
{
	float a = 1.0f / (*N);
	float b = 1.0f - a;

	*avg = a * new_value + b * (*avg);
}

static void extract_pcts(cs_de_report_t *p_report, uint8_t channel_index,
			 uint8_t antenna_permutation_index,
			 struct bt_hci_le_cs_step_data_tone_info *local_tone_info,
			 struct bt_hci_le_cs_step_data_tone_info *remote_tone_info)
{
	for (uint8_t tone_index = 0; tone_index < p_report->n_ap; tone_index++) {
		int antenna_path = bt_le_cs_get_antenna_path(p_report->n_ap,
							     antenna_permutation_index, tone_index);
		if (antenna_path < 0) {
			LOG_WRN("Invalid antenna path.");
			return;
		}

		if (local_tone_info[tone_index].quality_indicator !=
			    BT_HCI_LE_CS_TONE_QUALITY_HIGH ||
		    remote_tone_info[tone_index].quality_indicator !=
			    BT_HCI_LE_CS_TONE_QUALITY_HIGH) {
			return;
		}

		struct bt_le_cs_iq_sample local_iq =
			bt_le_cs_parse_pct(local_tone_info[tone_index].phase_correction_term);
		struct bt_le_cs_iq_sample remote_iq =
			bt_le_cs_parse_pct(remote_tone_info[tone_index].phase_correction_term);

		m_n_iqs[antenna_path][channel_index]++;

		if (m_n_iqs[antenna_path][channel_index] == 1) {
			p_report->iq_tones[antenna_path].i_local[channel_index] = local_iq.i;
			p_report->iq_tones[antenna_path].q_local[channel_index] = local_iq.q;
			p_report->iq_tones[antenna_path].i_remote[channel_index] = remote_iq.i;
			p_report->iq_tones[antenna_path].q_remote[channel_index] = remote_iq.q;
		} else {
			cumulate_mean(&p_report->iq_tones[antenna_path].i_local[channel_index],
				      local_iq.i, &m_n_iqs[antenna_path][channel_index]);
			cumulate_mean(&p_report->iq_tones[antenna_path].q_local[channel_index],
				      local_iq.q, &m_n_iqs[antenna_path][channel_index]);
			cumulate_mean(&p_report->iq_tones[antenna_path].i_remote[channel_index],
				      remote_iq.i, &m_n_iqs[antenna_path][channel_index]);
			cumulate_mean(&p_report->iq_tones[antenna_path].q_remote[channel_index],
				      remote_iq.q, &m_n_iqs[antenna_path][channel_index]);
		}
	}
}

static void extract_rtt_timings(cs_de_report_t *p_report,
				struct bt_hci_le_cs_step_data_mode_1 *local_rtt_data,
				struct bt_hci_le_cs_step_data_mode_1 *peer_rtt_data)
{
	if (local_rtt_data->packet_quality_aa_check !=
		    BT_HCI_LE_CS_PACKET_QUALITY_AA_CHECK_SUCCESSFUL ||
	    local_rtt_data->packet_rssi == BT_HCI_LE_CS_PACKET_RSSI_NOT_AVAILABLE ||
	    local_rtt_data->tod_toa_reflector == BT_HCI_LE_CS_TIME_DIFFERENCE_NOT_AVAILABLE ||
	    peer_rtt_data->packet_quality_aa_check !=
		    BT_HCI_LE_CS_PACKET_QUALITY_AA_CHECK_SUCCESSFUL ||
	    peer_rtt_data->packet_rssi == BT_HCI_LE_CS_PACKET_RSSI_NOT_AVAILABLE ||
	    peer_rtt_data->tod_toa_reflector == BT_HCI_LE_CS_TIME_DIFFERENCE_NOT_AVAILABLE) {
		return;
	}

	if (p_report->role == BT_CONN_LE_CS_ROLE_INITIATOR) {
		p_report->rtt_accumulated_half_ns +=
			local_rtt_data->toa_tod_initiator - peer_rtt_data->tod_toa_reflector;
	} else {
		p_report->rtt_accumulated_half_ns +=
			peer_rtt_data->toa_tod_initiator - local_rtt_data->tod_toa_reflector;
	}

	p_report->rtt_count++;
}

static bool process_ranging_header(struct ras_ranging_header *ranging_header, void *user_data)
{
	cs_de_report_t *p_report = (cs_de_report_t *)user_data;

	p_report->n_ap = MAX(1, ((ranging_header->antenna_paths_mask & BIT(0)) +
				 ((ranging_header->antenna_paths_mask & BIT(1)) >> 1) +
				 ((ranging_header->antenna_paths_mask & BIT(2)) >> 2) +
				 ((ranging_header->antenna_paths_mask & BIT(3)) >> 3)));
	return true;
}

static bool process_step_data(struct bt_le_cs_subevent_step *local_step,
			      struct bt_le_cs_subevent_step *peer_step, void *user_data)
{
	cs_de_report_t *p_report = (cs_de_report_t *)user_data;

	if (local_step->mode == BT_HCI_OP_LE_CS_MAIN_MODE_2) {
		struct bt_hci_le_cs_step_data_mode_2 *local_step_data =
			(struct bt_hci_le_cs_step_data_mode_2 *)local_step->data;
		struct bt_hci_le_cs_step_data_mode_2 *peer_step_data =
			(struct bt_hci_le_cs_step_data_mode_2 *)peer_step->data;

		extract_pcts(p_report, local_step->channel - CHANNEL_INDEX_OFFSET,
			     local_step_data->antenna_permutation_index, local_step_data->tone_info,
			     peer_step_data->tone_info);
	} else if (local_step->mode == BT_HCI_OP_LE_CS_MAIN_MODE_1) {
		struct bt_hci_le_cs_step_data_mode_1 *local_step_data =
			(struct bt_hci_le_cs_step_data_mode_1 *)local_step->data;
		struct bt_hci_le_cs_step_data_mode_1 *peer_step_data =
			(struct bt_hci_le_cs_step_data_mode_1 *)peer_step->data;

		extract_rtt_timings(p_report, local_step_data, peer_step_data);
	} else if (local_step->mode == BT_HCI_OP_LE_CS_MAIN_MODE_3) {
		struct bt_hci_le_cs_step_data_mode_3 *local_step_data =
			(struct bt_hci_le_cs_step_data_mode_3 *)local_step->data;
		struct bt_hci_le_cs_step_data_mode_3 *peer_step_data =
			(struct bt_hci_le_cs_step_data_mode_3 *)peer_step->data;

		extract_pcts(p_report, local_step->channel - CHANNEL_INDEX_OFFSET,
			     local_step_data->antenna_permutation_index, local_step_data->tone_info,
			     peer_step_data->tone_info);

		extract_rtt_timings(p_report,
				    (struct bt_hci_le_cs_step_data_mode_1 *)local_step_data,
				    (struct bt_hci_le_cs_step_data_mode_1 *)peer_step_data);
	}

	return true;
}

static void ranging_data_cb(struct bt_conn *conn, uint16_t ranging_counter, int err)
{
	ARG_UNUSED(conn);

	if (err) {
		LOG_ERR("Error when receiving ranging data with ranging counter %d (err %d)",
			ranging_counter, err);
		return;
	}

	if (ranging_counter != most_recent_local_ranging_counter) {
		LOG_INF("Ranging data dropped as peer ranging counter doesn't match local ranging "
			"data counter. (peer: %u, local: %u)",
			ranging_counter, most_recent_local_ranging_counter);
		net_buf_simple_reset(&latest_local_steps);
		k_sem_give(&sem_local_steps);
		return;
	}

	if (latest_local_steps.len == 0) {
		LOG_WRN("All subevents in ranging counter %u were aborted",
			most_recent_local_ranging_counter);
		net_buf_simple_reset(&latest_local_steps);
		k_sem_give(&sem_local_steps);

		if (!(ras_feature_bits & RAS_FEAT_REALTIME_RD)) {
			net_buf_simple_reset(&latest_peer_steps);
		}
		return;
	}

	memset(&m_cs_de_report, 0x0, sizeof(cs_de_report_t));
	memset(m_n_iqs, 0, sizeof(m_n_iqs));

	bt_ras_rreq_rd_subevent_data_parse(&latest_peer_steps, &latest_local_steps, cs_config.role,
					   process_ranging_header, NULL, process_step_data,
					   &m_cs_de_report);

	for (uint8_t ap = 0; ap < m_cs_de_report.n_ap; ap++) {
		m_cs_de_report.distance_estimates[ap].ifft = NAN;
		m_cs_de_report.distance_estimates[ap].phase_slope = NAN;
		m_cs_de_report.distance_estimates[ap].rtt = NAN;
		m_cs_de_report.distance_estimates[ap].best = NAN;

		if (m_is_tone_quality_ok(m_n_iqs[ap], cs_config.channel_map)) {
			m_cs_de_report.tone_quality[ap] = CS_DE_TONE_QUALITY_OK;
		} else {
			m_cs_de_report.tone_quality[ap] = CS_DE_TONE_QUALITY_BAD;
		}
	}

	net_buf_simple_reset(&latest_local_steps);

	if (!(ras_feature_bits & RAS_FEAT_REALTIME_RD)) {
		net_buf_simple_reset(&latest_peer_steps);
	}

	k_sem_give(&sem_local_steps);

	cs_de_quality_t quality = cs_de_calc(&m_cs_de_report);

	if (quality == CS_DE_QUALITY_OK) {
		for (uint8_t ap = 0; ap < m_cs_de_report.n_ap; ap++) {
			if (m_cs_de_report.tone_quality[ap] == CS_DE_TONE_QUALITY_OK ||
			    isfinite(m_cs_de_report.distance_estimates[ap].rtt)) {
				store_distance_estimates_in_buffer(
					&m_cs_de_report.distance_estimates[ap],
					&distance_estimate_buffers[ap]);
			}
		}
		k_sem_give(&sem_distance_estimate_updated);
	}
}

static void subevent_result_cb(struct bt_conn *conn, struct bt_conn_le_cs_subevent_result *result)
{
	if (dropped_ranging_counter == result->header.procedure_counter) {
		return;
	}

	if (most_recent_local_ranging_counter !=
	    bt_ras_rreq_get_ranging_counter(result->header.procedure_counter)) {
		int sem_state = k_sem_take(&sem_local_steps, K_NO_WAIT);

		if (sem_state < 0) {
			dropped_ranging_counter = result->header.procedure_counter;
			LOG_DBG("Dropped subevent results. Waiting for ranging data from peer.");
			return;
		}

		most_recent_local_ranging_counter =
			bt_ras_rreq_get_ranging_counter(result->header.procedure_counter);
	}

	if (result->header.subevent_done_status == BT_CONN_LE_CS_SUBEVENT_ABORTED) {
		/* The steps from this subevent will not be used. */
	} else if (result->step_data_buf) {
		if (result->step_data_buf->len <= net_buf_simple_tailroom(&latest_local_steps)) {
			uint16_t len = result->step_data_buf->len;
			uint8_t *step_data = net_buf_simple_pull_mem(result->step_data_buf, len);

			net_buf_simple_add_mem(&latest_local_steps, step_data, len);
		} else {
			LOG_ERR("Not enough memory to store step data. (%d > %d)",
				latest_local_steps.len + result->step_data_buf->len,
				latest_local_steps.size);
			net_buf_simple_reset(&latest_local_steps);
			dropped_ranging_counter = result->header.procedure_counter;
			return;
		}
	}

	dropped_ranging_counter = PROCEDURE_COUNTER_NONE;

	if (result->header.procedure_done_status == BT_CONN_LE_CS_PROCEDURE_COMPLETE) {
		most_recent_local_ranging_counter =
			bt_ras_rreq_get_ranging_counter(result->header.procedure_counter);
	} else if (result->header.procedure_done_status == BT_CONN_LE_CS_PROCEDURE_ABORTED) {
		LOG_WRN("Procedure %u aborted", result->header.procedure_counter);
		net_buf_simple_reset(&latest_local_steps);
		k_sem_give(&sem_local_steps);
	}
}

static void ranging_data_ready_cb(struct bt_conn *conn, uint16_t ranging_counter)
{
	if (ranging_counter == most_recent_local_ranging_counter) {
		int err = bt_ras_rreq_cp_get_ranging_data(connection, &latest_peer_steps,
							  ranging_counter, ranging_data_cb);
		if (err) {
			LOG_ERR("Get ranging data failed (err %d)", err);
			net_buf_simple_reset(&latest_local_steps);
			net_buf_simple_reset(&latest_peer_steps);
			k_sem_give(&sem_local_steps);
		}
	}
}

static void ranging_data_overwritten_cb(struct bt_conn *conn, uint16_t ranging_counter)
{
	LOG_DBG("Ranging data overwritten %i", ranging_counter);
}

/* bt_ras_rreq_read_features() rejects a NULL callback with -EINVAL — the result
 * is delivered here, not by return value, so there is nowhere else for the
 * feature bits to arrive.
 */
static void ras_features_read_cb(struct bt_conn *conn, uint32_t feature_bits, int err)
{
	ARG_UNUSED(conn);

	if (err) {
		LOG_WRN("Error while reading RAS feature bits (err %d)", err);
	} else {
		ras_feature_bits = feature_bits;
	}

	k_sem_give(&sem_ras_features);
}

/* ------------------------------------------------------------------------- */
/* Connection lifecycle                                                       */
/* ------------------------------------------------------------------------- */

static void mtu_exchange_cb(struct bt_conn *conn, uint8_t err,
			    struct bt_gatt_exchange_params *params)
{
	if (err) {
		LOG_ERR("MTU exchange failed (err %d)", err);
		return;
	}

	k_sem_give(&sem_mtu_exchange_done);
}

static void discovery_completed_cb(struct bt_gatt_dm *dm, void *context)
{
	int err;

	struct bt_conn *conn = bt_gatt_dm_conn_get(dm);

	err = bt_ras_rreq_alloc_and_assign_handles(dm, conn);
	if (err) {
		LOG_ERR("RAS RREQ alloc init failed (err %d)", err);
	}

	err = bt_gatt_dm_data_release(dm);
	if (err) {
		LOG_ERR("Could not release the discovery data (err %d)", err);
	}

	k_sem_give(&sem_discovery_done);
}

static void discovery_service_not_found_cb(struct bt_conn *conn, void *context)
{
	LOG_WRN("Ranging Service not found, disconnecting");
	bt_conn_disconnect(conn, BT_HCI_ERR_REMOTE_USER_TERM_CONN);
}

static void discovery_error_found_cb(struct bt_conn *conn, int err, void *context)
{
	LOG_WRN("Discovery failed (err %d)", err);
	bt_conn_disconnect(conn, BT_HCI_ERR_REMOTE_USER_TERM_CONN);
}

static struct bt_gatt_dm_cb discovery_cb = {
	.completed = discovery_completed_cb,
	.service_not_found = discovery_service_not_found_cb,
	.error_found = discovery_error_found_cb,
};

static void security_changed(struct bt_conn *conn, bt_security_t level, enum bt_security_err err)
{
	if (err) {
		LOG_ERR("Security failed: level %u err %d %s", level, err,
			bt_security_err_to_str(err));
		return;
	}

	k_sem_give(&sem_security);
}

static bool le_param_req(struct bt_conn *conn, struct bt_le_conn_param *param)
{
	/* Ignore peer parameter preferences. */
	return false;
}

static void connected_cb(struct bt_conn *conn, uint8_t err)
{
	char addr[BT_ADDR_LE_STR_LEN];

	(void)bt_addr_le_to_str(bt_conn_get_dst(conn), addr, sizeof(addr));

	if (err) {
		LOG_WRN("Failed to connect to %s (err 0x%02X)", addr, err);
		bt_conn_unref(conn);
		connection = NULL;
		k_sem_give(&sem_disconnected);
		return;
	}

	LOG_INF("Connected to %s", addr);
	connection = bt_conn_ref(conn);
	k_sem_give(&sem_connected);
}

static void disconnected_cb(struct bt_conn *conn, uint8_t reason)
{
	LOG_INF("Disconnected (reason 0x%02X)", reason);

	bt_conn_unref(conn);
	connection = NULL;

	/* The upstream sample reboots here. This gateway must not: a tag walking
	 * out of range is routine, and rebooting would drop every other tag in
	 * the rotation and lose the serial link to the bridge along with it.
	 *
	 * Waking every wait the ranging sequence might be parked on is what
	 * actually prevents the stall — a bounded timeout alone would still cost
	 * ten seconds per departed tag.
	 */
	k_sem_give(&sem_disconnected);
	k_sem_give(&sem_connected);
	k_sem_give(&sem_security);
	k_sem_give(&sem_mtu_exchange_done);
	k_sem_give(&sem_discovery_done);
	k_sem_give(&sem_ras_features);
	k_sem_give(&sem_remote_capabilities_obtained);
	k_sem_give(&sem_config_created);
	k_sem_give(&sem_cs_security_enabled);
	k_sem_give(&sem_distance_estimate_updated);
}

static void remote_capabilities_cb(struct bt_conn *conn, uint8_t status,
				   struct bt_conn_le_cs_capabilities *params)
{
	ARG_UNUSED(conn);
	ARG_UNUSED(params);

	if (status == BT_HCI_ERR_SUCCESS) {
		k_sem_give(&sem_remote_capabilities_obtained);
	} else {
		LOG_WRN("CS capability exchange failed. (HCI status 0x%02x)", status);
	}
}

static void config_create_cb(struct bt_conn *conn, uint8_t status,
			     struct bt_conn_le_cs_config *config)
{
	ARG_UNUSED(conn);

	if (status == BT_HCI_ERR_SUCCESS) {
		cs_config = *config;
		k_sem_give(&sem_config_created);
	} else {
		LOG_WRN("CS config creation failed. (HCI status 0x%02x)", status);
	}
}

static void security_enable_cb(struct bt_conn *conn, uint8_t status)
{
	ARG_UNUSED(conn);

	if (status == BT_HCI_ERR_SUCCESS) {
		k_sem_give(&sem_cs_security_enabled);
	} else {
		LOG_WRN("CS security enable failed. (HCI status 0x%02x)", status);
	}
}

static void procedure_enable_cb(struct bt_conn *conn, uint8_t status,
				struct bt_conn_le_cs_procedure_enable_complete *params)
{
	ARG_UNUSED(conn);

	if (status != BT_HCI_ERR_SUCCESS) {
		LOG_WRN("CS procedures enable failed. (HCI status 0x%02x)", status);
		return;
	}

	LOG_INF("CS procedures %s", params->state == 1 ? "enabled" : "disabled");
}

BT_CONN_CB_DEFINE(conn_cb) = {
	.connected = connected_cb,
	.disconnected = disconnected_cb,
	.le_param_req = le_param_req,
	.security_changed = security_changed,
	.le_cs_read_remote_capabilities_complete = remote_capabilities_cb,
	.le_cs_config_complete = config_create_cb,
	.le_cs_security_enable_complete = security_enable_cb,
	.le_cs_procedure_enable_complete = procedure_enable_cb,
	.le_cs_subevent_data_available = subevent_result_cb,
};

/* ------------------------------------------------------------------------- */
/* Scanning                                                                   */
/* ------------------------------------------------------------------------- */

/* Pull the tag UID out of the manufacturer-specific advertising data.
 *
 * Identifying tags before connecting is the whole point of putting the UID in
 * the advertisement: the BLE address randomises and carries no identity, and
 * connecting to every reflector in radio range just to find out who it is would
 * waste the rotation on strangers.
 */
static bool uid_from_ad(struct bt_data *data, void *user_data)
{
	char *uid_out = user_data;

	if (data->type != BT_DATA_MANUFACTURER_DATA || data->data_len != TAG_MFG_DATA_LEN) {
		return true; /* keep parsing */
	}

	if (sys_get_le16(data->data) != TAG_ADV_COMPANY_ID ||
	    data->data[2] != TAG_ADV_PROTO_VER) {
		return true;
	}

	for (int i = 0; i < TAG_UID_LEN; i++) {
		(void)snprintk(&uid_out[i * 2], 3, "%02x", data->data[3 + i]);
	}

	return false; /* found it, stop */
}

static void scan_recv_cb(const struct bt_le_scan_recv_info *info, struct net_buf_simple *buf)
{
	char uid[TAG_UID_STR_LEN] = {0};
	struct net_buf_simple copy;

	/* bt_data_parse consumes the buffer, and this callback does not own it. */
	net_buf_simple_clone(buf, &copy);
	bt_data_parse(&copy, uid_from_ad, uid);

	if (uid[0] == '\0') {
		return; /* not one of ours */
	}

	tag_seen(info->addr, uid, info->rssi);
}

static struct bt_le_scan_cb scan_callbacks = {
	.recv = scan_recv_cb,
};

/* ------------------------------------------------------------------------- */
/* Ranging one tag                                                            */
/* ------------------------------------------------------------------------- */

static void cs_config_get(struct bt_le_cs_create_config_params *config_params)
{
	memset(config_params, 0, sizeof(struct bt_le_cs_create_config_params));
	config_params->id = CS_CONFIG_ID;
	config_params->mode = CS_CONFIG_MODE;
	config_params->min_main_mode_steps = 2;
	config_params->max_main_mode_steps = 5;
	config_params->main_mode_repetition = 0;
	config_params->mode_0_steps = NUM_MODE_0_STEPS;
	config_params->role = BT_CONN_LE_CS_ROLE_INITIATOR;
	config_params->rtt_type = BT_CONN_LE_CS_RTT_TYPE_AA_ONLY;
	config_params->cs_sync_phy = BT_CONN_LE_CS_SYNC_1M_PHY;
	config_params->channel_map_repetition = 1;
	config_params->channel_selection_type = BT_CONN_LE_CS_CHSEL_TYPE_3B;
	config_params->ch3c_shape = BT_CONN_LE_CS_CH3C_SHAPE_HAT;
	config_params->ch3c_jump = 2;
}

static void session_semaphores_reset(void)
{
	k_sem_reset(&sem_connected);
	k_sem_reset(&sem_disconnected);
	k_sem_reset(&sem_security);
	k_sem_reset(&sem_mtu_exchange_done);
	k_sem_reset(&sem_discovery_done);
	k_sem_reset(&sem_ras_features);
	k_sem_reset(&sem_remote_capabilities_obtained);
	k_sem_reset(&sem_config_created);
	k_sem_reset(&sem_cs_security_enabled);
	k_sem_reset(&sem_distance_estimate_updated);
	k_sem_reset(&sem_local_steps);
	k_sem_give(&sem_local_steps);

	net_buf_simple_reset(&latest_local_steps);
	net_buf_simple_reset(&latest_peer_steps);
	most_recent_local_ranging_counter = PROCEDURE_COUNTER_NONE;
	dropped_ranging_counter = PROCEDURE_COUNTER_NONE;
	ras_feature_bits = 0;
}

/* Tear the current session down and wait for the stack to confirm it is gone,
 * so the next tag never starts against a half-open connection.
 */
static void session_teardown(void)
{
	if (connection) {
		bt_conn_disconnect(connection, BT_HCI_ERR_REMOTE_USER_TERM_CONN);
		/* Bounded: if the disconnect callback never lands the connection
		 * is already gone, and blocking here would be the exact stall
		 * this gateway must not have.
		 */
		(void)k_sem_take(&sem_disconnected, K_SECONDS(5));
	}
}

/* Run one ranging session against one tag.
 *
 * Every wait is bounded. On any failure the tag gets a `failed` observation
 * rather than silence, so a tag that is present but unrangeable is visible
 * upstream instead of looking identical to one that was never seen.
 */
static void range_one_tag(const struct tag_entry *tag)
{
	int err;
	bool reported = false;

	session_semaphores_reset();
	distance_buffers_reset();

	strncpy(current_tag_uid, tag->uid, TAG_UID_STR_LEN - 1);
	current_tag_uid[TAG_UID_STR_LEN - 1] = '\0';
	current_tag_rssi = tag->rssi;

	LOG_INF("Ranging tag uid=%s", current_tag_uid);

	/* bt_conn_le_create() hands back a reference of its own, and connected_cb
	 * takes a second one. Keeping both leaks the connection object: it is
	 * never freed, so the next attempt on the same address is refused with
	 * -EINVAL ("valid connection ... in disconnected state") and the tag can
	 * only ever be ranged once. Release this reference immediately and let
	 * connected_cb/disconnected_cb own the lifetime.
	 *
	 * The upstream sample does not hit this: it connects via the scan module's
	 * connect_if_match, which never hands the application a reference.
	 */
	struct bt_conn *pending = NULL;

	err = bt_conn_le_create(&tag->addr, BT_CONN_LE_CREATE_CONN,
				BT_LE_CONN_PARAM(0x10, 0x10, 0, BT_GAP_MS_TO_CONN_TIMEOUT(4000)),
				&pending);
	if (err) {
		LOG_WRN("Create connection failed (err %d)", err);
		report_ranging(current_tag_uid, false, 0.0f, false, tag->rssi);
		return;
	}

	bt_conn_unref(pending);

	if (k_sem_take(&sem_connected, STEP_TIMEOUT) != 0 || connection == NULL) {
		LOG_WRN("Connection to uid=%s timed out", current_tag_uid);
		goto fail;
	}

	err = bt_conn_set_security(connection, BT_SECURITY_L2);
	if (err) {
		LOG_WRN("Failed to encrypt connection (err %d)", err);
		goto fail;
	}

	if (k_sem_take(&sem_security, STEP_TIMEOUT) != 0 || connection == NULL) {
		LOG_WRN("Security setup timed out");
		goto fail;
	}

	static struct bt_gatt_exchange_params mtu_exchange_params = {.func = mtu_exchange_cb};

	err = bt_gatt_exchange_mtu(connection, &mtu_exchange_params);
	if (err) {
		LOG_WRN("MTU exchange failed to start (err %d)", err);
		goto fail;
	}

	if (k_sem_take(&sem_mtu_exchange_done, STEP_TIMEOUT) != 0 || connection == NULL) {
		LOG_WRN("MTU exchange timed out");
		goto fail;
	}

	err = bt_gatt_dm_start(connection, BT_UUID_RANGING_SERVICE, &discovery_cb, NULL);
	if (err) {
		LOG_WRN("Discovery failed to start (err %d)", err);
		goto fail;
	}

	if (k_sem_take(&sem_discovery_done, STEP_TIMEOUT) != 0 || connection == NULL) {
		LOG_WRN("Discovery timed out");
		goto fail;
	}

	const struct bt_le_cs_set_default_settings_param default_settings = {
		.enable_initiator_role = true,
		.enable_reflector_role = false,
		.cs_sync_antenna_selection = BT_LE_CS_ANTENNA_SELECTION_OPT_REPETITIVE,
		.max_tx_power = BT_HCI_OP_LE_CS_MAX_MAX_TX_POWER,
	};

	err = bt_le_cs_set_default_settings(connection, &default_settings);
	if (err) {
		LOG_WRN("Failed to configure default CS settings (err %d)", err);
		goto fail;
	}

	err = bt_ras_rreq_read_features(connection, ras_features_read_cb);
	if (err) {
		LOG_WRN("Could not get RAS features from peer (err %d)", err);
		goto fail;
	}

	if (k_sem_take(&sem_ras_features, STEP_TIMEOUT) != 0 || connection == NULL) {
		LOG_WRN("RAS feature read timed out");
		goto fail;
	}

	const bool realtime_rd = ras_feature_bits & RAS_FEAT_REALTIME_RD;

	if (realtime_rd) {
		err = bt_ras_rreq_realtime_rd_subscribe(connection, &latest_peer_steps,
							ranging_data_cb);
		if (err) {
			LOG_WRN("Real-time ranging data subscribe failed (err %d)", err);
			goto fail;
		}
	} else {
		err = bt_ras_rreq_rd_overwritten_subscribe(connection,
							   ranging_data_overwritten_cb);
		if (err) {
			LOG_WRN("Ranging data overwritten subscribe failed (err %d)", err);
			goto fail;
		}

		err = bt_ras_rreq_rd_ready_subscribe(connection, ranging_data_ready_cb);
		if (err) {
			LOG_WRN("Ranging data ready subscribe failed (err %d)", err);
			goto fail;
		}

		err = bt_ras_rreq_on_demand_rd_subscribe(connection);
		if (err) {
			LOG_WRN("On-demand ranging data subscribe failed (err %d)", err);
			goto fail;
		}

		err = bt_ras_rreq_cp_subscribe(connection);
		if (err) {
			LOG_WRN("CP subscribe failed (err %d)", err);
			goto fail;
		}
	}

	err = bt_le_cs_read_remote_supported_capabilities(connection);
	if (err) {
		LOG_WRN("Failed to exchange CS capabilities (err %d)", err);
		goto fail;
	}

	if (k_sem_take(&sem_remote_capabilities_obtained, STEP_TIMEOUT) != 0 ||
	    connection == NULL) {
		LOG_WRN("CS capability exchange timed out");
		goto fail;
	}

	struct bt_le_cs_create_config_params config_params;

	cs_config_get(&config_params);
	bt_le_cs_set_valid_chmap_bits(config_params.channel_map);

	err = bt_le_cs_create_config(connection, &config_params,
				     BT_LE_CS_CREATE_CONFIG_CONTEXT_LOCAL_AND_REMOTE);
	if (err) {
		LOG_WRN("Failed to create CS config (err %d)", err);
		goto fail;
	}

	if (k_sem_take(&sem_config_created, STEP_TIMEOUT) != 0 || connection == NULL) {
		LOG_WRN("CS config creation timed out");
		goto fail;
	}

	err = bt_le_cs_security_enable(connection);
	if (err) {
		LOG_WRN("Failed to start CS Security (err %d)", err);
		goto fail;
	}

	if (k_sem_take(&sem_cs_security_enabled, STEP_TIMEOUT) != 0 || connection == NULL) {
		LOG_WRN("CS security enable timed out");
		goto fail;
	}

	/* scale factor of conn_interval units to proc_interval units is
	 * 1.25/0.625 = 2
	 */
	const uint16_t acl_interval_in_proc_interval_units = 0x10 * 2;
	uint16_t desired_procedure_interval = realtime_rd ? 5 : 10;
	uint16_t desired_max_procedure_length =
		acl_interval_in_proc_interval_units * (desired_procedure_interval - 1);

	const struct bt_le_cs_set_procedure_parameters_param procedure_params = {
		.config_id = CS_CONFIG_ID,
		.max_procedure_len = desired_max_procedure_length,
		.min_procedure_interval = desired_procedure_interval,
		.max_procedure_interval = desired_procedure_interval,
		.max_procedure_count = 0,
		.min_subevent_len = 16000,
		.max_subevent_len = 16000,
		.tone_antenna_config_selection = BT_LE_CS_TONE_ANTENNA_CONFIGURATION_A1_B1,
		.phy = BT_LE_CS_PROCEDURE_PHY_2M,
		.tx_power_delta = 0x80,
		.preferred_peer_antenna = BT_LE_CS_PROCEDURE_PREFERRED_PEER_ANTENNA_1,
		.snr_control_initiator = BT_LE_CS_SNR_CONTROL_NOT_USED,
		.snr_control_reflector = BT_LE_CS_SNR_CONTROL_NOT_USED,
	};

	err = bt_le_cs_set_procedure_parameters(connection, &procedure_params);
	if (err) {
		LOG_WRN("Failed to set procedure parameters (err %d)", err);
		goto fail;
	}

	struct bt_le_cs_procedure_enable_param params = {
		.config_id = CS_CONFIG_ID,
		.enable = 1,
	};

	err = bt_le_cs_procedure_enable(connection, &params);
	if (err) {
		LOG_WRN("Failed to enable CS procedures (err %d)", err);
		goto fail;
	}

	/* Range for the dwell window, reporting each fresh estimate, then hand
	 * the radio to the next tag.
	 */
	int64_t deadline = k_uptime_get() + RANGING_DWELL_MS;
	/* Rate limit. CS produces fresh estimates at ~10 Hz, which is far more
	 * than the database needs and would write ~860k rows per tag per day.
	 * Reporting on an interval instead mirrors how the T-Beam tag paces
	 * itself with SEND_INTERVAL_MS. Nothing is lost by discarding the
	 * in-between estimates: they are already folded into the median window
	 * that get_distance() reports from.
	 */
	int64_t next_report = 0;

	while (k_uptime_get() < deadline) {
		int64_t remaining = deadline - k_uptime_get();

		if (k_sem_take(&sem_distance_estimate_updated, K_MSEC(remaining)) != 0) {
			break;
		}

		if (connection == NULL) {
			break; /* tag vanished mid-session */
		}

		if (k_uptime_get() < next_report) {
			continue;
		}
		next_report = k_uptime_get() + CONFIG_CS_GATEWAY_REPORT_MIN_MS;

		for (uint8_t ap = 0; ap < MAX_AP; ap++) {
			if (distance_estimate_buffers[ap].num_valid == 0) {
				continue;
			}

			cs_de_dist_estimates_t d = get_distance(ap);
			/* ifft is the mode-2 estimate; fall back to rtt when the
			 * phase-based one is not finite.
			 */
			float best = isfinite(d.ifft) ? d.ifft : d.rtt;

			if (!isfinite(best) || best < 0.0f) {
				continue;
			}

			report_ranging(current_tag_uid, true, best,
				       m_cs_de_report.tone_quality[ap] == CS_DE_TONE_QUALITY_OK,
				       current_tag_rssi);
			reported = true;
		}
	}

fail:
	if (!reported) {
		/* Never silently skip: a tag that was advertising but could not be
		 * ranged is a real observation, and omitting it would look
		 * identical upstream to the tag not being there at all.
		 */
		report_ranging(current_tag_uid, false, 0.0f, false, current_tag_rssi);
	}

	session_teardown();
}

/* ------------------------------------------------------------------------- */

int main(void)
{
	int err;

	/* Debug goes to the log backend; machine-readable JSON goes to printk on
	 * the same UART. The bridge discards any line not starting with '{',
	 * which is the same rule the T-Echo gateway relies on.
	 */
	LOG_INF("Starting Channel Sounding gateway (fw " CONFIG_CS_GATEWAY_FW_VERSION ")");
	LOG_INF("gateway_id=" CONFIG_CS_GATEWAY_ID);

	err = bt_enable(NULL);
	if (err) {
		LOG_ERR("Bluetooth init failed (err %d)", err);
		return 0;
	}

	bt_le_scan_cb_register(&scan_callbacks);

	int64_t next_status = 0;

	while (true) {
		/* Scan with an explicit window rather than continuously: the
		 * radio cannot scan and range at the same time, so the two take
		 * turns.
		 */
		err = bt_le_scan_start(BT_LE_SCAN_PASSIVE, NULL);
		if (err && err != -EALREADY) {
			LOG_ERR("Scanning failed to start (err %d)", err);
			k_sleep(K_SECONDS(1));
			continue;
		}

		k_sleep(K_MSEC(SCAN_WINDOW_MS));

		err = bt_le_scan_stop();
		if (err && err != -EALREADY) {
			LOG_WRN("Scanning failed to stop (err %d)", err);
		}

		if (k_uptime_get() >= next_status) {
			report_status();
			next_status = k_uptime_get() + CONFIG_CS_GATEWAY_STATUS_MS;
		}

		struct tag_entry tag;

		if (tag_next(&tag)) {
			range_one_tag(&tag);
		}
	}

	return 0;
}
