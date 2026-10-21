import { defineAuth } from "fluxdown-plugin-sdk/runtime";
import { authenticate } from "./auth/session";
import { hostFromFlux } from "./host";

defineAuth(async (ctx) => authenticate(hostFromFlux(flux), ctx));
