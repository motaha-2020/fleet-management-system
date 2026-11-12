import { Global, Inject, Module, OnApplicationShutdown } from "@nestjs/common";
import { PgBoss } from "pg-boss";
import type pg from "pg";
import { controlDb, SecretBox, TenantPools, JOBS } from "@fleet/db";
import { CONFIG, CONTROL_DB, CONTROL_POOL, MAILER, PUSH, QUEUE, SECRETS, STORAGE, TENANT_POOLS } from "./tokens.js";
import { LogMailer, SmtpMailer, type Mailer } from "./mailer.js";
import { ExpoPushSender, LogPushSender, type PushSender } from "./push.js";
import { FsStorage, createS3Storage, type ObjectStorage } from "../files/storage.js";
import type { AppConfig } from "../config.js";

/** Minimal queue port so tests or another backend can replace pg-boss (ADR-006). */
export interface JobQueue {
  send(name: string, data: object, opts?: { singletonKey?: string }): Promise<void>;
  stop(): Promise<void>;
}

export async function createPgBossQueue(url: string): Promise<JobQueue> {
  const boss = new PgBoss({ connectionString: url, schema: "pgboss" });
  boss.on("error", (e) => console.error("[queue]", e));
  await boss.start();
  for (const q of [JOBS.provisionTenant, "alerts.scan", "alerts.daily"]) await boss.createQueue(q).catch(() => {});
  return {
    async send(name, data, opts) {
      await boss.send(name, data, { retryLimit: 3, retryDelay: 10, retryBackoff: true, ...(opts?.singletonKey ? { singletonKey: opts.singletonKey } : {}) });
    },
    stop: () => boss.stop({ graceful: true }),
  };
}

@Global()
@Module({})
export class InfraModule implements OnApplicationShutdown {
  static forRoot(config: AppConfig, overrides: { queue?: JobQueue; storage?: ObjectStorage; mailer?: Mailer; push?: PushSender } = {}) {
    const control = controlDb(config.controlDatabaseUrl);
    const secrets = new SecretBox(config.masterKey);
    return {
      module: InfraModule,
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: CONTROL_POOL, useValue: control.pool },
        { provide: CONTROL_DB, useValue: control.db },
        { provide: SECRETS, useValue: secrets },
        { provide: TENANT_POOLS, useValue: new TenantPools(control.db, secrets) },
        { provide: QUEUE, useFactory: () => overrides.queue ?? createPgBossQueue(config.controlDatabaseUrl) },
        { provide: PUSH, useValue: overrides.push ?? (config.push.driver === "expo" ? new ExpoPushSender(config.push.accessToken) : new LogPushSender()) },
        { provide: MAILER, useValue: overrides.mailer ?? (config.mail.smtpUrl ? new SmtpMailer(config.mail.smtpUrl, config.mail.from) : new LogMailer()) },
        {
          provide: STORAGE,
          useFactory: () => overrides.storage ?? (config.storage.driver === "s3" ? createS3Storage(config.storage) : new FsStorage(config.storage.dir)),
        },
      ],
      exports: [CONFIG, CONTROL_POOL, CONTROL_DB, SECRETS, TENANT_POOLS, QUEUE, STORAGE, MAILER, PUSH],
    };
  }

  constructor(
    @Inject(CONTROL_POOL) private readonly pool: pg.Pool,
    @Inject(TENANT_POOLS) private readonly tenants: TenantPools,
    @Inject(QUEUE) private readonly queue: JobQueue,
  ) {}

  async onApplicationShutdown() {
    await this.queue.stop();
    await this.tenants.closeAll();
    await this.pool.end();
  }
}
