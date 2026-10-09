/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Desktop analytics no-op stub for the free local desktop editor fork.
 * Disables external telemetry tracking.
 */

export type AnalyticsEventData = Record<string, string | number | boolean>;

/** A product event from the renderer. No-op in free local editor fork. */
export async function trackEvent(_name: string, _data: AnalyticsEventData = {}): Promise<void> {
  // Telemetry disabled in free local editor fork
}

export async function trackInstall(): Promise<void> {
  // Telemetry disabled in free local editor fork
}
