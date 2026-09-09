/*
 * xiao-cs-tag — Bluetooth Channel Sounding tag for periplus.
 *
 * Based on the nRF Connect SDK sample
 * nrf/samples/bluetooth/channel_sounding/ras_reflector.
 *
 * Flow:
 *   boot -> read fixed UID from FICR.DEVICEID -> advertise it in
 *   manufacturer-specific data -> accept a gateway connection -> act as CS
 *   Reflector and RAS server -> on disconnect, advertise again.
 *
 * This device never knows where it is. It has no GPS and computes nothing; it
 * only ever gets ranged by a gateway. Its whole job is to be findable by a
 * stable identity and to reflect.
 *
 * Board: xiao_nrf54l15/nrf54l15/cpuapp
 */

#include <zephyr/types.h>
#include <zephyr/kernel.h>
#include <zephyr/bluetooth/bluetooth.h>
#include <zephyr/bluetooth/conn.h>
#include <zephyr/bluetooth/uuid.h>
#include <zephyr/bluetooth/cs.h>
#include <zephyr/drivers/hwinfo.h>
#include <zephyr/settings/settings.h>
#include <bluetooth/services/ras.h>
#include <dk_buttons_and_leds.h>

#include <zephyr/logging/log.h>
LOG_MODULE_REGISTER(cs_tag, LOG_LEVEL_INF);

#define CON_STATUS_LED DK_LED1

/* Bluetooth SIG company identifier reserved for testing. This project has no
 * assigned company ID; swap this for a real one before any production use, and
 * bump TAG_ADV_PROTO_VER if the payload layout changes with it.
 */
#define TAG_ADV_COMPANY_ID 0xFFFF
#define TAG_ADV_PROTO_VER  0x01

#define TAG_UID_LEN 8
/* 16 hex chars + NUL. Must match the ^[0-9a-f]{16}$ check on devices.device_id
 * (devices_ble_cs_uid_format, scoped to CS tags).
 */
#define TAG_UID_STR_LEN (TAG_UID_LEN * 2 + 1)

static uint8_t tag_uid[TAG_UID_LEN];
static char tag_uid_str[TAG_UID_STR_LEN];

/* [0..1] company ID (little endian), [2] payload version, [3..10] the UID.
 * Filled in at boot once the UID is known, so it is a mutable buffer rather
 * than a BT_DATA_BYTES literal.
 */
static uint8_t mfg_data[3 + TAG_UID_LEN] = {
	TAG_ADV_COMPANY_ID & 0xFF,
	TAG_ADV_COMPANY_ID >> 8,
	TAG_ADV_PROTO_VER,
};

static const struct bt_data ad[] = {
	BT_DATA_BYTES(BT_DATA_FLAGS, (BT_LE_AD_GENERAL | BT_LE_AD_NO_BREDR)),
	/* The Ranging Service UUID lets a gateway filter on "is a CS reflector"
	 * before it has parsed anything vendor-specific.
	 */
	BT_DATA_BYTES(BT_DATA_UUID16_ALL, BT_UUID_16_ENCODE(BT_UUID_RANGING_SERVICE_VAL)),
	BT_DATA(BT_DATA_MANUFACTURER_DATA, mfg_data, sizeof(mfg_data)),
};

/* Advertising interval is the main power knob on this device: it is what the
 * tag spends energy on whenever no gateway is connected. 250-350 ms trades a
 * little discovery latency for markedly less airtime than the samples' fast
 * advertising. Widen it if battery life matters more than how quickly a
 * gateway notices a tag walking into range.
 */
#define TAG_ADV_INTERVAL_MIN 400 /* 250 ms in 0.625 ms units */
#define TAG_ADV_INTERVAL_MAX 560 /* 350 ms in 0.625 ms units */

static const struct bt_le_adv_param *adv_param =
	BT_LE_ADV_PARAM(BT_LE_ADV_OPT_CONN, TAG_ADV_INTERVAL_MIN, TAG_ADV_INTERVAL_MAX, NULL);

static K_SEM_DEFINE(sem_connected, 0, 1);
static K_SEM_DEFINE(sem_config, 0, 1);

static struct bt_conn *connection;

static void advertising_start(void)
{
	int err = bt_le_adv_start(adv_param, ad, ARRAY_SIZE(ad), NULL, 0);

	if (err) {
		LOG_ERR("Advertising failed to start (err %d)", err);
		return;
	}

	LOG_INF("Advertising as uid=%s", tag_uid_str);
}

/* Restarting advertising from inside the disconnected callback would call a
 * blocking Bluetooth API from the BT RX thread, so it is deferred to the system
 * work queue.
 */
static void adv_work_handler(struct k_work *work)
{
	ARG_UNUSED(work);
	advertising_start();
}

static K_WORK_DEFINE(adv_work, adv_work_handler);

/* Derive the tag's permanent identity.
 *
 * hwinfo on Nordic parts reads FICR.DEVICEID, which is programmed at the
 * factory. That makes the UID survive a reflash, a full erase and BLE address
 * randomisation, which the BLE MAC would not — and it means every tag runs a
 * byte-identical firmware image with no provisioning step and no stored state
 * to lose. Provisioning a physical tag is therefore just "flash it and read the
 * UID it prints at boot".
 */
static int tag_uid_init(void)
{
	ssize_t len = hwinfo_get_device_id(tag_uid, sizeof(tag_uid));

	if (len < 0) {
		LOG_ERR("Failed to read device id (err %d)", (int)len);
		return (int)len;
	}

	if (len != TAG_UID_LEN) {
		/* Refuse rather than zero-pad: a short read would silently produce
		 * a UID that is not the one this tag is meant to be known by.
		 */
		LOG_ERR("Device id is %d bytes, expected %d", (int)len, TAG_UID_LEN);
		return -EINVAL;
	}

	for (int i = 0; i < TAG_UID_LEN; i++) {
		/* Lowercase hex, matching the database's tag_uid format check. */
		(void)snprintk(&tag_uid_str[i * 2], 3, "%02x", tag_uid[i]);
	}

	memcpy(&mfg_data[3], tag_uid, TAG_UID_LEN);

	return 0;
}

static void connected_cb(struct bt_conn *conn, uint8_t err)
{
	char addr[BT_ADDR_LE_STR_LEN];

	(void)bt_addr_le_to_str(bt_conn_get_dst(conn), addr, sizeof(addr));
	LOG_INF("Connected to %s (err 0x%02X)", addr, err);

	if (err) {
		bt_conn_unref(conn);
		connection = NULL;
		k_work_submit(&adv_work);
		return;
	}

	connection = bt_conn_ref(conn);
	k_sem_give(&sem_connected);
	dk_set_led_on(CON_STATUS_LED);
}

static void disconnected_cb(struct bt_conn *conn, uint8_t reason)
{
	LOG_INF("Disconnected (reason 0x%02X)", reason);

	bt_conn_unref(conn);
	connection = NULL;

	dk_set_led_off(CON_STATUS_LED);

	/* The upstream sample reboots here. A tag that reboots every time a
	 * gateway walks away would drop off the air for its whole boot time on
	 * a completely normal event, so it re-advertises instead. The semaphores
	 * are reset so a stale give from the previous session cannot make the
	 * next one skip a wait.
	 */
	k_sem_reset(&sem_connected);
	k_sem_reset(&sem_config);

	k_work_submit(&adv_work);
}

static void remote_capabilities_cb(struct bt_conn *conn, uint8_t status,
				   struct bt_conn_le_cs_capabilities *params)
{
	ARG_UNUSED(conn);
	ARG_UNUSED(params);

	if (status == BT_HCI_ERR_SUCCESS) {
		LOG_INF("CS capability exchange completed.");
	} else {
		LOG_WRN("CS capability exchange failed. (HCI status 0x%02x)", status);
	}
}

static void config_create_cb(struct bt_conn *conn, uint8_t status,
			     struct bt_conn_le_cs_config *config)
{
	ARG_UNUSED(conn);

	if (status == BT_HCI_ERR_SUCCESS) {
		LOG_INF("CS config created (id %u, mode %u)", config->id, config->mode);
		k_sem_give(&sem_config);
	} else {
		LOG_WRN("CS config creation failed. (HCI status 0x%02x)", status);
	}
}

static void security_enable_cb(struct bt_conn *conn, uint8_t status)
{
	ARG_UNUSED(conn);

	if (status == BT_HCI_ERR_SUCCESS) {
		LOG_INF("CS security enabled.");
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
	.le_cs_read_remote_capabilities_complete = remote_capabilities_cb,
	.le_cs_config_complete = config_create_cb,
	.le_cs_security_enable_complete = security_enable_cb,
	.le_cs_procedure_enable_complete = procedure_enable_cb,
};

int main(void)
{
	int err;

	LOG_INF("Starting Channel Sounding tag (fw " CONFIG_CS_TAG_FW_VERSION ")");

	dk_leds_init();

	err = tag_uid_init();
	if (err) {
		/* Without a stable identity this tag cannot be told apart from any
		 * other, so advertising anyway would put anonymous observations in
		 * the database. Stop instead.
		 */
		LOG_ERR("No stable UID available, refusing to advertise");
		return 0;
	}

	/* Printed on its own line so provisioning a physical tag is just reading
	 * this off the console and recording it against the device.
	 */
	LOG_INF("TAG UID: %s", tag_uid_str);

	err = bt_enable(NULL);
	if (err) {
		LOG_ERR("Bluetooth init failed (err %d)", err);
		return 0;
	}

	if (IS_ENABLED(CONFIG_BT_SETTINGS)) {
		settings_load();
	}

	advertising_start();

	while (true) {
		k_sem_take(&sem_connected, K_FOREVER);

		const struct bt_le_cs_set_default_settings_param default_settings = {
			.enable_initiator_role = false,
			.enable_reflector_role = true,
			.cs_sync_antenna_selection = BT_LE_CS_ANTENNA_SELECTION_OPT_REPETITIVE,
			.max_tx_power = BT_HCI_OP_LE_CS_MAX_MAX_TX_POWER,
		};

		err = bt_le_cs_set_default_settings(connection, &default_settings);
		if (err) {
			LOG_ERR("Failed to configure default CS settings (err %d)", err);
			continue;
		}

		/* Bounded rather than K_FOREVER: a gateway that connects and then
		 * goes away without ever creating a CS config would otherwise park
		 * this loop permanently, and the tag would stay silently connected
		 * to nothing.
		 */
		if (k_sem_take(&sem_config, K_SECONDS(10)) != 0) {
			LOG_WRN("No CS config within 10s, waiting for a new connection");
			continue;
		}

		const struct bt_le_cs_set_procedure_parameters_param procedure_params = {
			.config_id = 0,
			.max_procedure_len = 1000,
			.min_procedure_interval = 1,
			.max_procedure_interval = 100,
			.max_procedure_count = 0,
			.min_subevent_len = 10000,
			.max_subevent_len = 75000,
			.tone_antenna_config_selection = BT_LE_CS_TONE_ANTENNA_CONFIGURATION_A1_B1,
			.phy = BT_LE_CS_PROCEDURE_PHY_2M,
			.tx_power_delta = 0x80,
			.preferred_peer_antenna = BT_LE_CS_PROCEDURE_PREFERRED_PEER_ANTENNA_1,
			.snr_control_initiator = BT_LE_CS_SNR_CONTROL_NOT_USED,
			.snr_control_reflector = BT_LE_CS_SNR_CONTROL_NOT_USED,
		};

		err = bt_le_cs_set_procedure_parameters(connection, &procedure_params);
		if (err) {
			LOG_ERR("Failed to set procedure parameters (err %d)", err);
		}
	}

	return 0;
}
