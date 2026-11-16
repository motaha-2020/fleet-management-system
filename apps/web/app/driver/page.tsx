"use client";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { COUNTRY_TEMPLATES, EGYPT, INSPECTION_ITEMS } from "@fleet/config";
import type { Task, TaskLine, Vehicle } from "@fleet/contracts";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { apiErrorMessage } from "@/lib/errors";
import { fmtDateTime } from "@/lib/format";

type Geo = { location: { lat: number; lng: number; accuracyM: number | null } | null; locationStatus: "ok" | "denied" | "unavailable" };
/** Where the browser is now (asked only while recording); a refusal never blocks. */
function locate(): Promise<Geo> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ location: null, locationStatus: "unavailable" });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ location: { lat: Math.round(p.coords.latitude * 1e6) / 1e6, lng: Math.round(p.coords.longitude * 1e6) / 1e6, accuracyM: Math.round(p.coords.accuracy) }, locationStatus: "ok" }),
      (e) => resolve({ location: null, locationStatus: e.code === e.PERMISSION_DENIED ? "denied" : "unavailable" }),
      { timeout: 10_000, maximumAge: 300_000 },
    );
  });
}

type View =
  | { kind: "home" } | { kind: "fuel"; v: Vehicle; last: number | null } | { kind: "odometer"; v: Vehicle; last: number | null } | { kind: "defect"; v: Vehicle }
  | { kind: "inspect"; v: Vehicle } | { kind: "tasks" } | { kind: "line"; task: Task; line: TaskLine; action: "start" | "finish" } | { kind: "alerts" };

const btn = "flex min-h-12 w-full items-center justify-center rounded-xl px-4 text-base font-bold";
const primary = `${btn} bg-accent text-white disabled:opacity-60`;
const secondary = `${btn} border border-accent text-accent bg-surface`;
const input = "min-h-12 w-full rounded-xl border border-[#CBD2D9] bg-surface px-3 text-lg";

/**
 * Driver web version (owner decision 14 Nov 2026): the same screens as the phone app — vehicles, fuel, odometer with a
 * meter photo, defects, inspections, my tasks, notifications — online only. Everything goes straight to the API and
 * follows the same rules (approval, maker ≠ checker, scope).
 */
export default function DriverWeb() {
  const { api, user, ready, signOut } = useSession();
  const { t } = useI18n();
  const D = t.driverWeb, X = t.driverApp;
  const router = useRouter();
  const [view, setView] = useState<View>({ kind: "home" });
  const [notice, setNotice] = useState<{ text: string; danger?: boolean } | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [odo, setOdo] = useState<Record<string, number | null>>({});

  useEffect(() => {
    if (ready && !user) router.replace("/driver/login");
    else if (ready && user && user.role !== "driver") router.replace("/vehicles");
  }, [ready, user, router]);

  const load = useCallback(async () => {
    const vs = (await api.call("listVehicles")).items;
    setVehicles(vs);
    const entries = await Promise.all(vs.map(async (v) => [v.id, (await api.call("vehicleOdometer", { params: { id: v.id } }).catch(() => null))?.current?.value ?? null] as const));
    setOdo(Object.fromEntries(entries));
  }, [api]);
  useEffect(() => { if (user?.role === "driver") void load().catch(() => setVehicles([])); }, [user, load]);

  const done = (msg?: string, danger?: boolean) => { setView({ kind: "home" }); setNotice(msg ? { text: msg, danger } : null); if (msg) void load(); window.scrollTo({ top: 0 }); };
  if (!ready || !user || user.role !== "driver") return <div className="p-10 text-center text-muted">{t.common.loading}</div>;

  return (
    <div className="mx-auto min-h-screen max-w-md bg-[#F4F6F8]">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
        {view.kind !== "home"
          ? <button className="font-bold text-accent" onClick={() => (view.kind === "line" ? setView({ kind: "tasks" }) : done())}>{X.back}</button>
          : <span className="font-bold">{user.displayName}</span>}
        <span className="ms-auto text-sm text-muted">{user.tenant?.name}</span>
        {view.kind === "home" && <button className="text-sm font-semibold text-accent" onClick={async () => { await signOut(); router.replace("/driver/login"); }}>{t.common.logout}</button>}
      </header>
      <main className="flex flex-col gap-3 p-4">
        {notice && view.kind === "home" && <p className={`rounded-xl p-3 font-semibold ${notice.danger ? "bg-bad-bg text-bad" : "bg-ok-bg text-ok"}`} role={notice.danger ? "alert" : "status"}>{notice.text}</p>}
        {view.kind === "home" && (
          <>
            <p className="rounded-xl bg-accent-soft p-3 text-sm text-accent-ink">{D.onlineOnly}</p>
            <div className="grid grid-cols-2 gap-2">
              <button className={primary} onClick={() => setView({ kind: "tasks" })} data-testid="driver-web-tasks">{X.myTasks}</button>
              <button className={secondary} onClick={() => setView({ kind: "alerts" })}>{D.notifications}</button>
            </div>
            <h2 className="mt-2 font-bold">{X.vehicles}</h2>
            {!vehicles ? <p className="text-muted">{t.common.loading}</p> : !vehicles.length ? <p className="text-muted">{X.noVehicles}</p> : vehicles.map((v) => (
              <section key={v.id} className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4">
                <p className="text-lg font-bold">{v.fleetNumber} · <span dir="ltr">{v.registrationNumber}</span></p>
                <p className="text-sm text-muted">{v.make} {v.model} · {X.lastOdometer}: {odo[v.id] != null ? odo[v.id]!.toLocaleString("en") : "—"}</p>
                <div className="grid grid-cols-2 gap-2">
                  <button className={primary} onClick={() => setView({ kind: "fuel", v, last: odo[v.id] ?? null })}>{X.recordFuel}</button>
                  <button className={secondary} onClick={() => setView({ kind: "odometer", v, last: odo[v.id] ?? null })}>{X.recordOdometer}</button>
                  <button className={secondary} onClick={() => setView({ kind: "defect", v })}>{t.m4.driver.report}</button>
                  <button className={secondary} onClick={() => setView({ kind: "inspect", v })}>{X.inspection}</button>
                </div>
              </section>
            ))}
          </>
        )}
        {view.kind === "fuel" && <FuelForm v={view.v} last={view.last} onDone={done} />}
        {view.kind === "odometer" && <OdometerForm v={view.v} last={view.last} onDone={done} />}
        {view.kind === "defect" && <DefectForm v={view.v} onDone={done} />}
        {view.kind === "inspect" && <InspectForm v={view.v} onDone={done} />}
        {view.kind === "tasks" && <Tasks vehicles={vehicles ?? []} onWork={(task, line, action) => setView({ kind: "line", task, line, action })} />}
        {view.kind === "line" && <LineForm {...view} vehicle={vehicles?.find((v) => v.id === view.line.vehicleId) ?? null} onDone={(msg) => { setNotice(msg ? { text: msg } : null); setView({ kind: "tasks" }); }} />}
        {view.kind === "alerts" && <Alerts />}
      </main>
    </div>
  );
}

function Form({ title, onSubmit, error, busy, children }: { title: string; onSubmit: (e: FormEvent) => void; error: string | null; busy: boolean; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4">
      <h1 className="text-lg font-bold">{title}</h1>
      {children}
      {error && <p className="rounded-xl bg-bad-bg p-3 font-semibold text-bad" role="alert">{error}</p>}
      <button type="submit" className={primary} disabled={busy}>{busy ? t.common.loading : t.driverApp.submit}</button>
    </form>
  );
}

const Label = ({ text, children }: { text: string; children: ReactNode }) => (
  <label className="flex flex-col gap-1.5 text-sm font-semibold">{text}{children}</label>
);

/** Camera photo (on phones the browser opens the camera); shows a preview. */
function PhotoField({ label, file, onFile, required }: { label: string; file: File | null; onFile: (f: File | null) => void; required?: boolean }) {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return (
    <label className={`flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 p-3 ${file ? "border-ok" : "border-dashed border-accent"}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url ? <img src={url} alt="" className="h-36 rounded-lg object-cover" /> : <span className="text-3xl">📷</span>}
      <span className="font-bold text-accent">{label}{required ? " *" : ""}</span>
      <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
    </label>
  );
}

/** Biggest believable distance since the last reading before the driver is asked to check the number again. */
const ODOMETER_JUMP_KM = 2000;

/**
 * QA 16 Nov 2026: a reading below the last one (or far above it) is almost always a typo. The driver is warned and
 * has to press Submit a second time with the same number; the server still flags it for the approver either way.
 */
function useOdometerGuard(last: number | null) {
  const { t } = useI18n();
  const [confirmed, setConfirmed] = useState<number | null>(null);
  return (odo: number): string | null => {
    if (last == null || confirmed === odo) return null;
    const fmt = (n: number) => n.toLocaleString("en");
    let msg: string | null = null;
    if (odo < last) msg = t.driverApp.odometerBelowLast.replace("{value}", fmt(odo)).replace("{last}", fmt(last));
    else if (odo - last > ODOMETER_JUMP_KM) msg = t.driverApp.odometerBigJump.replace("{value}", fmt(odo)).replace("{last}", fmt(last)).replace("{diff}", fmt(odo - last));
    if (msg) setConfirmed(odo);
    return msg;
  };
}

function useSubmit() {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (err) { setError(apiErrorMessage(t, err)); } finally { setBusy(false); }
  };
  return { error, setError, busy, run };
}

function FuelForm({ v, last, onDone }: { v: Vehicle; last: number | null; onDone: (msg?: string) => void }) {
  const { api, user } = useSession();
  const { t } = useI18n();
  const X = t.driverApp;
  const country = COUNTRY_TEMPLATES[user?.tenant?.countryCode ?? ""] ?? EGYPT;
  const types = [v.primaryFuelType, ...(v.secondaryFuelType ? [v.secondaryFuelType] : [])];
  const [f, setF] = useState({ fuelType: types[0]!, quantity: "", amount: "", odometer: "", isFull: true, payment: "cash" as "cash" | "card" });
  const [receipt, setReceipt] = useState<File | null>(null);
  const [geo] = useState(locate);
  const { error, setError, busy, run } = useSubmit();
  const guard = useOdometerGuard(last);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = Number(f.quantity.replace(",", ".")), amt = Number(f.amount.replace(",", ".")), odo = parseInt(f.odometer, 10);
    if (!(q > 0) || !(amt > 0) || !(odo >= 0)) return setError(X.invalidNumber);
    if (f.payment === "cash" && !receipt) return setError(X.receiptRequired);
    const odoWarning = guard(odo);
    if (odoWarning) return setError(odoWarning);
    void run(async () => {
      const g = await geo;
      const entry = await api.call("createFuelEntry", { body: { vehicleId: v.id, odometer: odo, fuelType: f.fuelType, quantity: q, amountMinor: Math.round(amt * 100), isFull: f.isFull, payment: f.payment, ...g } });
      if (receipt) await api.upload("uploadFuelReceipt", { id: entry.id }, receipt, receipt.name);
      onDone(X.savedPendingApproval);
    });
  };
  return (
    <Form title={`${X.recordFuel} · ${v.fleetNumber}`} onSubmit={submit} error={error} busy={busy}>
      <Label text={X.fuelType}>
        <select className={input} value={f.fuelType} onChange={(e) => setF({ ...f, fuelType: e.target.value })}>
          {types.map((c) => <option key={c} value={c}>{country.fuelTypes.find((x) => x.code === c)?.name.ar ?? c}</option>)}
        </select>
      </Label>
      <Label text={X.quantity}><input className={input} inputMode="decimal" dir="ltr" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Label>
      <Label text={X.amount}><input className={input} inputMode="decimal" dir="ltr" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Label>
      <Label text={X.odometer}><input className={input} inputMode="numeric" dir="ltr" value={f.odometer} onChange={(e) => setF({ ...f, odometer: e.target.value.replace(/\D/g, "") })} /></Label>
      <div className="grid grid-cols-2 gap-2">
        {(["cash", "card"] as const).map((p) => <button type="button" key={p} className={f.payment === p ? primary : secondary} onClick={() => setF({ ...f, payment: p })}>{X[p]}</button>)}
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={f.isFull} onChange={(e) => setF({ ...f, isFull: e.target.checked })} />{X.full}</label>
      <PhotoField label={X.takePhoto} file={receipt} onFile={setReceipt} required={f.payment === "cash"} />
    </Form>
  );
}

function OdometerForm({ v, last, onDone }: { v: Vehicle; last: number | null; onDone: (msg?: string) => void }) {
  const { api } = useSession();
  const { t } = useI18n();
  const X = t.driverApp;
  const [value, setValue] = useState("");
  const [photo, setPhoto] = useState<{ file: File; at: string; geo: Promise<Geo> } | null>(null);
  const { error, setError, busy, run } = useSubmit();
  const guard = useOdometerGuard(last);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const odo = parseInt(value, 10);
    if (!/^\d{1,7}$/.test(value)) return setError(X.invalidNumber);
    if (!photo) return setError(X.odometerPhotoRequired);
    const odoWarning = guard(odo);
    if (odoWarning) return setError(odoWarning);
    void run(async () => {
      const g = await photo.geo;
      const r = await api.call("createReading", { body: { vehicleId: v.id, value: odo, photoTakenAt: photo.at, ...g } });
      await api.upload("uploadOdometerPhoto", { id: r.id }, photo.file, photo.file.name);
      onDone(X.savedPendingApproval);
    });
  };
  return (
    <Form title={`${X.recordOdometer} · ${v.fleetNumber}`} onSubmit={submit} error={error} busy={busy}>
      {last != null && <p className="text-sm text-muted">{X.lastOdometer}: <b>{last.toLocaleString("en")}</b></p>}
      <PhotoField label={X.odometerPhoto} file={photo?.file ?? null} onFile={(file) => setPhoto(file ? { file, at: new Date().toISOString(), geo: locate() } : null)} required />
      <Label text={X.confirmOdometer}><input className={`${input} text-center text-xl`} inputMode="numeric" dir="ltr" value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))} /></Label>
    </Form>
  );
}

function DefectForm({ v, onDone }: { v: Vehicle; onDone: (msg?: string) => void }) {
  const { api } = useSession();
  const { t } = useI18n();
  const M = t.m4.driver, X = t.driverApp;
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<"low" | "medium" | "high" | "critical">("medium");
  const [drivable, setDrivable] = useState(true);
  const [photo, setPhoto] = useState<File | null>(null);
  const { error, setError, busy, run } = useSubmit();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (description.trim().length < 3) return setError(M.description);
    void run(async () => {
      const d = await api.call("createDefect", { body: { vehicleId: v.id, description, severity, drivable } });
      if (photo) await api.upload("uploadDefectPhoto", { id: d.id }, photo, photo.name);
      onDone(X.saved);
    });
  };
  return (
    <Form title={`${M.report} · ${v.fleetNumber}`} onSubmit={submit} error={error} busy={busy}>
      <Label text={M.description}><textarea className={`${input} min-h-24 py-2`} value={description} onChange={(e) => setDescription(e.target.value)} /></Label>
      <Label text={M.severity}>
        <select className={input} value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)}>
          {(["low", "medium", "high", "critical"] as const).map((s) => <option key={s} value={s}>{t.m4.defects.severities[s]}</option>)}
        </select>
      </Label>
      <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={drivable} onChange={(e) => setDrivable(e.target.checked)} />{M.drivable}</label>
      <PhotoField label={M.photo} file={photo} onFile={setPhoto} />
    </Form>
  );
}

function InspectForm({ v, onDone }: { v: Vehicle; onDone: (msg?: string, danger?: boolean) => void }) {
  const { api } = useSession();
  const { t } = useI18n();
  const X = t.driverApp;
  const [checks, setChecks] = useState<Record<string, { ok: boolean; note: string }>>(() => Object.fromEntries(INSPECTION_ITEMS.map((i) => [i.code, { ok: true, note: "" }])));
  const [odometer, setOdometer] = useState("");
  const { error, busy, run } = useSubmit();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api.call("createInspection", { body: { vehicleId: v.id, odometer: odometer ? parseInt(odometer, 10) : null, items: Object.entries(checks).map(([code, c]) => ({ code, ok: c.ok, note: c.note || null })) } });
      // QA 16 Nov 2026: a failed safety item means "do not drive" — said plainly, in red.
      const unsafe = INSPECTION_ITEMS.filter((i) => i.critical && !checks[i.code]?.ok).map((i) => i.name.ar);
      if (unsafe.length) onDone(X.criticalFailWarning.replace("{items}", unsafe.join("، ")), true);
      else onDone(X.savedPendingApproval);
    });
  };
  return (
    <Form title={`${X.inspection} · ${v.fleetNumber}`} onSubmit={submit} error={error} busy={busy}>
      {INSPECTION_ITEMS.map((item) => {
        const c = checks[item.code]!;
        return (
          <div key={item.code} className="flex flex-col gap-2 rounded-xl border border-line p-3">
            <span className="font-semibold">{item.name.ar}{item.critical ? " *" : ""}</span>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={c.ok ? `${btn} bg-ok text-white` : secondary} onClick={() => setChecks({ ...checks, [item.code]: { ...c, ok: true } })}>{X.checkOk}</button>
              <button type="button" className={!c.ok ? `${btn} bg-bad text-white` : secondary} onClick={() => setChecks({ ...checks, [item.code]: { ...c, ok: false } })}>{X.checkProblem}</button>
            </div>
            {!c.ok && <input className={input} placeholder={X.problemNote} value={c.note} onChange={(e) => setChecks({ ...checks, [item.code]: { ...c, note: e.target.value } })} />}
          </div>
        );
      })}
      <Label text={`${X.odometer} (${t.common.optional})`}><input className={input} inputMode="numeric" dir="ltr" value={odometer} onChange={(e) => setOdometer(e.target.value.replace(/\D/g, ""))} /></Label>
    </Form>
  );
}

function Tasks({ vehicles, onWork }: { vehicles: Vehicle[]; onWork: (task: Task, line: TaskLine, action: "start" | "finish") => void }) {
  const { api, user } = useSession();
  const { t, locale } = useI18n();
  const X = t.driverApp;
  const [tasks, setTasks] = useState<Task[] | null>(null);
  useEffect(() => { void api.call("listTasks", { query: {} }).then((r) => setTasks(r.items.filter((k) => ["planned", "in_progress", "done"].includes(k.status)))).catch(() => setTasks([])); }, [api]);
  const vName = (id: string) => vehicles.find((v) => v.id === id)?.fleetNumber ?? "—";
  if (!tasks) return <p className="text-muted">{t.common.loading}</p>;
  if (!tasks.length) return <p className="text-muted">{X.noTasks}</p>;
  return (
    <>
      {tasks.map((k) => (
        <section key={k.id} className="flex flex-col gap-1 rounded-2xl border border-line bg-surface p-4">
          <p className="text-lg font-bold">{k.title}</p>
          <p className="text-sm text-muted">{k.customerName}</p>
          {k.kind === "trip" && <p className="text-sm text-muted">{k.fromPlace} ← {k.toPlace}</p>}
          <p className="text-sm text-muted">{fmtDateTime(k.startsAt, locale)} — {fmtDateTime(k.endsAt, locale)}{k.dailyStart ? ` · ${k.dailyStart}–${k.dailyEnd}` : ""}</p>
          {k.status === "done" && <p className="font-semibold text-ok">{X.taskDone}</p>}
          {k.lines.filter((l) => l.driverId === user?.driverId && !l.endedAt).map((l) => (
            <div key={l.id} className="mt-2 flex flex-col gap-2">
              <p className="text-sm font-semibold">{X.vehicle}: {vName(l.vehicleId)}{l.startOdometer != null ? ` · ${X.startedAt}: ${l.startOdometer.toLocaleString("en")}` : ""}</p>
              {!l.startedAt ? <button className={primary} onClick={() => onWork(k, l, "start")}>{X.startTask}</button>
                : <button className={`${btn} bg-ok text-white`} onClick={() => onWork(k, l, "finish")}>{X.finishTask}</button>}
            </div>
          ))}
        </section>
      ))}
    </>
  );
}

function LineForm({ task, line, action, vehicle, onDone }: { task: Task; line: TaskLine; action: "start" | "finish"; vehicle: Vehicle | null; onDone: (msg?: string) => void }) {
  const { api } = useSession();
  const { t } = useI18n();
  const X = t.driverApp;
  const [value, setValue] = useState("");
  const [photo, setPhoto] = useState<{ file: File; geo: Promise<Geo> } | null>(null);
  const { error, setError, busy, run } = useSubmit();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const odo = parseInt(value, 10);
    if (!/^\d{1,7}$/.test(value)) return setError(X.invalidNumber);
    if (!photo) return setError(X.odometerPhotoRequired);
    if (action === "finish" && line.startOdometer != null && odo < line.startOdometer) return setError(X.belowStart);
    void run(async () => {
      const g = await photo.geo;
      const k = await api.call(action === "start" ? "startTaskLine" : "finishTaskLine", { params: { id: task.id }, body: { lineId: line.id, odometer: odo, location: g.location } });
      const l = k.lines.find((x) => x.id === line.id);
      const readingId = action === "start" ? l?.startReadingId : l?.endReadingId;
      if (readingId) await api.upload("uploadOdometerPhoto", { id: readingId }, photo.file, photo.file.name);
      onDone(X.saved);
    });
  };
  return (
    <Form title={`${action === "start" ? X.startTask : X.finishTask} · ${vehicle?.fleetNumber ?? ""}`} onSubmit={submit} error={error} busy={busy}>
      <p className="font-semibold">{task.title} — {task.customerName}</p>
      {action === "finish" && line.startOdometer != null && <p className="text-sm text-muted">{X.startedAt}: <b>{line.startOdometer.toLocaleString("en")}</b></p>}
      <PhotoField label={X.odometerPhoto} file={photo?.file ?? null} onFile={(file) => setPhoto(file ? { file, geo: locate() } : null)} required />
      <Label text={X.confirmOdometer}><input className={`${input} text-center text-xl`} inputMode="numeric" dir="ltr" value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))} /></Label>
    </Form>
  );
}

function Alerts() {
  const { api } = useSession();
  const { t, locale } = useI18n();
  const [items, setItems] = useState<{ id: string; subject: string | null; type: string; createdAt?: string }[] | null>(null);
  useEffect(() => { void api.call("listAlerts", { query: {} }).then((r) => setItems(r.items as never)).catch(() => setItems([])); }, [api]);
  if (!items) return <p className="text-muted">{t.common.loading}</p>;
  if (!items.length) return <p className="text-muted">{t.driverWeb.noNotifications}</p>;
  return (
    <>
      {items.map((a) => (
        <section key={a.id} className="rounded-2xl border border-line bg-surface p-4">
          <p className="font-semibold">{a.subject ?? a.type}</p>
          {a.createdAt && <p className="text-xs text-muted">{fmtDateTime(a.createdAt, locale)}</p>}
        </section>
      ))}
    </>
  );
}
