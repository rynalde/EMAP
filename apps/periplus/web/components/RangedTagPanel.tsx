"use client";

import {
  type DevicePosition,
  STATUS_COLOR,
  STATUS_LABEL,
  relativeAge,
  statusOf,
} from "../lib/types";

/**
 * Lists tags that are ranged rather than positioned.
 *
 * Separate from TagPanel on purpose: a GPS tag without a fix and a Channel
 * Sounding tag are both "no position", but for opposite reasons — the first has
 * failed at something it is trying to do, the second was never trying. Merging
 * them would make every CS tag look like a broken GPS tag.
 */
export default function RangedTagPanel({ tags }: { tags: DevicePosition[] }) {
  if (tags.length === 0) {
    return null;
  }

  return (
    <ul className="taglist">
      {tags.map((t) => {
        const status = statusOf(t);
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
                {/* A failed measurement shows no number at all rather than a
                    stale one — the same rule the GPS side follows for lat/lng. */}
                {t.distance_m != null ? (
                  <> &middot; {t.distance_m.toFixed(2)} m away</>
                ) : (
                  <> &middot; no distance</>
                )}
              </div>
              <div className="tagmeta dim">
                {t.reported_by_label ?? "unknown gateway"}
                {t.rssi != null && <> &middot; {t.rssi} dBm</>}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
