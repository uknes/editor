/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createTRPCClient, httpBatchLink, TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { supabase } from "./supabase";
import type { AppRouter } from "@diffusionstudio/api-contract";

export const HOSTED_SERVICE_UNAVAILABLE_MESSAGE =
  "This operation is still connected to the hosted Diffusion service and is not available locally yet.";

export const paymentRequiredLink: TRPCLink<AppRouter> = () => ({ next, op }) =>
  observable((observer) => {
    const sub = next(op).subscribe({
      next: (value) => observer.next(value),
      error: (err) => {
        if (err instanceof TRPCClientError && err.data?.code === "PAYMENT_REQUIRED") {
          err.message = HOSTED_SERVICE_UNAVAILABLE_MESSAGE;
          observer.error(err);
          return;
        }
        observer.error(err);
      },
      complete: () => observer.complete(),
    });
    return () => sub.unsubscribe();
  });

export const trpc = createTRPCClient<AppRouter>({
  links: [
    paymentRequiredLink,
    httpBatchLink({
      url: `${import.meta.env.VITE_API_URL ?? ""}/api/trpc`,
      async headers() {
        const session = await supabase?.auth.getSession();
        const token = session?.data.session?.access_token;
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});
