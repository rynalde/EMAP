"use client";

import {
  type DevicePosition,
  LINK_LABEL,
  STATUS_COLOR,
  STATUS_LABEL,
  isLocated,
  relativeAge,
  statusOf,
} from "../lib/types";

/**
 * Lists every positioning tag, including those with no position. A tag that
 * cannot see the sky is still reporting — dropping it from the UI because it
 * has no coordinates would hide a working device and look identical to one that
 * is offline.
 */
export default function TagPanel({ tags }: { tags: DevicePosition[] }) {
  if (tags.length === 0) {
    return <p className="empty">No tags have reported yet.</p>;
  }

  return (
    <ul className="taglist">
      {tags.map((t) => {
        const status = statusOf(t);
        const located = isLocated(t);
        return (
          <li key={t.device_id} className="tagitem">
            <span className="dot" style={{ background: STATUS_COLOR[status] }} />
            <div className="taginfo">
              <div className="tagtop">
                <span className="tagid">{t.label ?? t.device_id}</span>
                <span className="age">{relativeAge(t.recorded_at)}</span>
              </div>
              <div className="tagmeta">
                {STATUS_LABEL[status]}
                {located ? (
                  <> &middot; {t.lat!.toFixed(5)}, {t.lng!.toFixed(5)}</>
                ) : (
                  <> &middot; no position</>
                )}
              </div>
              <div className="tagmeta dim">
                {LINK_LABEL[t.link] ?? t.link}
                {/* A cellular tag has no gateway; the link tells them apart. */}
                {t.reported_by_label && <> via {t.reported_by_label}</>}
                {" "}&middot; {t.sats ?? 0} sats
                {t.rssi != null && <> &middot; {t.rssi} dBm</>}
                {t.snr != null && <> &middot; SNR {t.snr}</>}
                {t.battery_mv ? <> &middot; {t.battery_mv} mV</> : null}
                {t.seq != null && <> &middot; seq {t.seq}</>}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
