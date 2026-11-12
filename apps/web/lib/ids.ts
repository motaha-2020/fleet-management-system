import { uuidv7 } from "@fleet/domain";
/** Client-generated id so a retried create (double click, flaky network) is idempotent. */
export const newId = () => uuidv7(Date.now(), crypto.getRandomValues(new Uint8Array(10)));
