/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal, onCleanup } from "solid-js";
import { Capacitor } from "@capacitor/core";

export function checkIsPhone(): boolean {
  if (typeof window === "undefined") return false;

  // 1. Capacitor native app running on mobile (Android / iOS)
  if (Capacitor.isNativePlatform()) return true;

  // 2. Mobile User Agent
  const ua = navigator.userAgent || "";
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;

  // 3. Screen width under 900px or vertical portrait phone orientation
  const isSmallWidth = window.innerWidth <= 840;
  const isPortraitPhone = window.innerHeight > window.innerWidth && window.innerWidth <= 920;

  return isSmallWidth || isPortraitPhone;
}

export function useIsPhone() {
  const [isPhone, setIsPhone] = createSignal(checkIsPhone());

  if (typeof window !== "undefined") {
    const handler = () => setIsPhone(checkIsPhone());
    window.addEventListener("resize", handler);
    window.addEventListener("orientationchange", handler);
    onCleanup(() => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("orientationchange", handler);
    });
  }

  return isPhone;
}
