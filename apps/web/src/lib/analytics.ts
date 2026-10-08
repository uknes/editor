/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Analytics no-op stub for the free local desktop editor fork.
 * Disables external telemetry tracking.
 */

type UmamiEventData = Record<string, string | number | boolean | undefined>;

export function initAnalytics(): void {}

export function track(_event: string, _data?: UmamiEventData): void {}

export function identify(_userId: string, _traits?: UmamiEventData): void {}

export function resetIdentity(): void {}
