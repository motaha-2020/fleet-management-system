import { randomBytes } from "node:crypto";
import { uuidv7 } from "@fleet/domain";
export const newId = () => uuidv7(Date.now(), randomBytes(10));
