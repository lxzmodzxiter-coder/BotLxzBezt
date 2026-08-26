import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  CircleAlert,
  Clock3,
  Fingerprint,
  Gauge,
  KeyRound,
  Loader2,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  UserCheck,
  UsersRound,
  Webhook,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

type SettingsForm = {
  isEnabled: boolean;
  defaultDailyLimit: number;
  unauthorizedAlertThreshold: number;
  alertWindowMinutes: number;
  quotaWarningPercent: number;
};

const initialSettings: SettingsForm = {
  isEnabled: true,
  defaultDailyLimit: 30,
  unauthorizedAlertThreshold: 3,
  alertWindowMinutes: 15,
  quotaWarningPercent: 80,
};

const numberFormatter = new Intl.NumberFormat("es-PE");

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "Sin registros";
  return new Intl.DateTimeFormat("es-PE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getStatusStyle(status: string) {
  if (status === "found") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (status === "denied" || status === "failed") return "bg-rose-50 text-rose-700 ring-rose-200";
  if (status === "not_found" || status === "invalid_input") return "bg-amber-50 text-amber-700 ring-amber-200";
  return "bg-slate-100 text-slate-600 ring-slate-200";
}

function MetricCard({ label, value, detail, icon: Icon, accent }: {
  label: string;
  value: number;
  detail: string;
  icon: typeof ShieldCheck;
  accent: "gold" | "teal" | "blue" | "rose";
}) {
  const tones = {
    gold: "bg-amber-100 text-amber-700",
    teal: "bg-teal-100 text-teal-700",
    blue: "bg-sky-100 text-sky-700",
    rose: "bg-rose-100 text-rose-700",
  };
  return (
    <Card className="overflow-hidden border-white/80 bg-white/85 shadow-[0_18px_50px_-30px_rgba(15,40,55,0.35)] backdrop-blur-sm">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
            <p className="mt-3 font-serif text-3xl font-semibold tracking-tight text-slate-950">{numberFormatter.format(value)}</p>
            <p className="mt-1 text-xs text-slate-500">{detail}</p>
          </div>
          <span className={cn("grid h-10 w-10 place-items-center rounded-xl", tones[accent])}>
            <Icon className="h-5 w-5" />
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function SectionHeading({ eyebrow, title, description, action }: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal-700">{eyebrow}</p>
        <h2 className="mt-1 font-serif text-2xl font-semibold tracking-tight text-slate-950">{title}</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">{description}</p>
      </div>
      {action}
    </div>
  );
}

export default function Home() {
  const { user } = useAuth();
  const [location] = useLocation();
  const isAdmin = user?.role === "admin";
  const publicOrigin = typeof window === "undefined" ? undefined : window.location.origin;
  const [settingsForm, setSettingsForm] = useState<SettingsForm>(initialSettings);
  const [userForm, setUserForm] = useState({ telegramUserId: "", displayName: "", username: "", dailyLimit: 30 });
  const utils = trpc.useUtils();

  const dashboard = trpc.bot.dashboard.useQuery(undefined, { enabled: isAdmin });
  const authorizedUsers = trpc.bot.authorizedUsers.useQuery(undefined, { enabled: isAdmin });
  const settings = trpc.bot.settings.useQuery(undefined, { enabled: isAdmin });
  const audits = trpc.bot.recentAudits.useQuery({ limit: 12 }, { enabled: isAdmin });
  const securityEvents = trpc.bot.securityEvents.useQuery({ limit: 12 }, { enabled: isAdmin });
  const webhook = trpc.bot.webhookInfo.useQuery({ publicOrigin }, { enabled: isAdmin });

  useEffect(() => {
    if (settings.data) {
      setSettingsForm({
        isEnabled: settings.data.isEnabled,
        defaultDailyLimit: settings.data.defaultDailyLimit,
        unauthorizedAlertThreshold: settings.data.unauthorizedAlertThreshold,
        alertWindowMinutes: settings.data.alertWindowMinutes,
        quotaWarningPercent: settings.data.quotaWarningPercent,
      });
    }
  }, [settings.data]);

  const saveUser = trpc.bot.saveAuthorizedUser.useMutation({
    onSuccess: async () => {
      toast.success("Usuario autorizado actualizado");
      setUserForm(form => ({ ...form, telegramUserId: "", displayName: "", username: "" }));
      await utils.bot.authorizedUsers.invalidate();
      await utils.bot.dashboard.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const saveSettings = trpc.bot.saveSettings.useMutation({
    onSuccess: async () => {
      toast.success("Controles operativos guardados");
      await utils.bot.settings.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const configureWebhook = trpc.bot.configureWebhook.useMutation({
    onSuccess: async result => {
      if (result.success) toast.success("Webhook configurado en Telegram");
      else toast.error(result.status);
      await utils.bot.webhookInfo.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  const section = useMemo(() => {
    if (location === "/usuarios") return "users";
    if (location === "/actividad") return "activity";
    if (location === "/webhook") return "webhook";
    return "dashboard";
  }, [location]);

  const refreshAll = () => {
    void Promise.all([
      dashboard.refetch(),
      authorizedUsers.refetch(),
      settings.refetch(),
      audits.refetch(),
      securityEvents.refetch(),
      webhook.refetch(),
    ]).then(() => toast.success("Panel actualizado"));
  };

  if (!isAdmin) {
    return (
      <DashboardLayout>
        <div className="grid min-h-[70vh] place-items-center">
          <Card className="max-w-lg border-amber-200 bg-amber-50/70 shadow-none">
            <CardHeader>
              <div className="mb-2 grid h-11 w-11 place-items-center rounded-xl bg-amber-100 text-amber-700"><LockKeyhole className="h-5 w-5" /></div>
              <CardTitle className="font-serif text-2xl">Acceso administrativo requerido</CardTitle>
              <CardDescription className="leading-6">Este es un panel interno. Solo el responsable del proyecto puede gestionar autorizaciones, revisar auditorías o configurar la conexión.</CardDescription>
            </CardHeader>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  const content = (
    <div className="mx-auto max-w-7xl space-y-8">
      {section === "dashboard" && (
        <>
          <section className="relative overflow-hidden rounded-[1.75rem] border border-slate-800 bg-[#0b2635] px-6 py-8 text-white shadow-[0_24px_70px_-34px_rgba(8,37,53,0.75)] sm:px-8">
            <div className="pointer-events-none absolute -right-12 -top-20 h-72 w-72 rounded-full bg-teal-400/15 blur-3xl" />
            <div className="pointer-events-none absolute bottom-0 left-1/2 h-px w-2/3 bg-gradient-to-r from-transparent via-amber-300/60 to-transparent" />
            <div className="relative flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
              <div className="max-w-2xl">
                <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-teal-100"><ShieldCheck className="h-3.5 w-3.5" /> Entorno interno protegido</div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-200">Centro de control</p>
                <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">Consultas autorizadas, con trazabilidad.</h1>
                <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">Gestiona el acceso de tu equipo a consultas de DNI y RUC. El bot valida, limita y registra cada operación sin guardar respuestas completas.</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button variant="outline" onClick={refreshAll} className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"><RefreshCw className="mr-2 h-4 w-4" />Actualizar</Button>
                <Button onClick={() => void configureWebhook.mutateAsync({ publicOrigin })} disabled={configureWebhook.isPending || !webhook.data?.secretsConfigured} className="bg-amber-300 text-slate-950 hover:bg-amber-200"><Webhook className="mr-2 h-4 w-4" />{configureWebhook.isPending ? "Conectando…" : "Conectar webhook"}</Button>
              </div>
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Autorizados" value={dashboard.data?.authorizedUsers || 0} detail="Usuarios registrados" icon={UsersRound} accent="gold" />
            <MetricCard label="Activos" value={dashboard.data?.activeUsers || 0} detail="Con acceso habilitado" icon={UserCheck} accent="teal" />
            <MetricCard label="Consultas hoy" value={dashboard.data?.todayQueries || 0} detail="Auditoría mínima" icon={Fingerprint} accent="blue" />
            <MetricCard label="Eventos hoy" value={dashboard.data?.todayWarnings || 0} detail="Alertas y seguridad" icon={AlertTriangle} accent="rose" />
          </section>

          <section className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
            <Card className="border-white/80 bg-white/85 shadow-[0_18px_50px_-30px_rgba(15,40,55,0.35)]">
              <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                <div><CardTitle className="font-serif text-xl">Actividad reciente</CardTitle><CardDescription>Solo se muestra el tipo y estado de la consulta, nunca el documento.</CardDescription></div>
                <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100">Últimas 12</Badge>
              </CardHeader>
              <CardContent className="space-y-2">
                {audits.data?.length ? audits.data.slice(0, 6).map(audit => (
                  <div key={audit.requestId} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-3">
                    <div className="min-w-0"><p className="text-sm font-medium text-slate-800">{audit.documentType.toUpperCase()} · {audit.displayName || audit.username || "Usuario autorizado"}</p><p className="mt-0.5 text-xs text-slate-500">{formatDate(audit.createdAt)} · {audit.providerDurationMs ? `${audit.providerDurationMs} ms` : "Sin latencia registrada"}</p></div>
                    <Badge className={cn("shrink-0 border-0 ring-1", getStatusStyle(audit.status))}>{audit.status.replaceAll("_", " ")}</Badge>
                  </div>
                )) : <EmptyState icon={Clock3} text="Aún no hay consultas registradas." />}
              </CardContent>
            </Card>
            <Card className="border-white/80 bg-[linear-gradient(160deg,#f7fbfa,#eef7f4)] shadow-[0_18px_50px_-30px_rgba(15,40,55,0.35)]">
              <CardHeader><CardTitle className="font-serif text-xl">Postura de seguridad</CardTitle><CardDescription>Controles aplicados a cada actualización.</CardDescription></CardHeader>
              <CardContent className="space-y-4">
                <SecurityLine label="Token y API solo en servidor" active />
                <SecurityLine label="Validación antes de consultar" active />
                <SecurityLine label="Auditoría con huella HMAC" active />
                <SecurityLine label="Límites por usuario y día" active />
                <SecurityLine label="Respuestas minimizadas" active />
              </CardContent>
            </Card>
          </section>
        </>
      )}

      {section === "users" && (
        <>
          <SectionHeading eyebrow="Control de acceso" title="Usuarios autorizados" description="Añade o actualiza el identificador numérico de Telegram de cada persona con permiso de consulta. Las altas se aplican al instante." />
          <section className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
            <Card className="border-white/80 bg-white/90 shadow-[0_18px_50px_-30px_rgba(15,40,55,0.35)]"><CardHeader><CardTitle className="font-serif text-xl">Nueva autorización</CardTitle><CardDescription>Pide al usuario que envíe <code>/start</code> al bot para conocer su identificador.</CardDescription></CardHeader><CardContent className="space-y-4">
              <Field label="ID numérico de Telegram"><Input value={userForm.telegramUserId} onChange={event => setUserForm({ ...userForm, telegramUserId: event.target.value.replace(/\D/g, "") })} placeholder="Ej.: 123456789" inputMode="numeric" /></Field>
              <Field label="Nombre de referencia"><Input value={userForm.displayName} onChange={event => setUserForm({ ...userForm, displayName: event.target.value })} placeholder="Ej.: Operaciones Lima" /></Field>
              <Field label="Usuario de Telegram (opcional)"><Input value={userForm.username} onChange={event => setUserForm({ ...userForm, username: event.target.value })} placeholder="Ej.: @usuario" /></Field>
              <Field label="Límite diario"><Input type="number" min={1} max={1000} value={userForm.dailyLimit} onChange={event => setUserForm({ ...userForm, dailyLimit: Number(event.target.value) || 1 })} /></Field>
              <Button className="w-full bg-[#0b2635] hover:bg-[#10384c]" disabled={saveUser.isPending || !userForm.telegramUserId} onClick={() => saveUser.mutate({ ...userForm, isActive: true })}>{saveUser.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserCheck className="mr-2 h-4 w-4" />}Guardar autorización</Button>
            </CardContent></Card>
            <Card className="border-white/80 bg-white/90 shadow-[0_18px_50px_-30px_rgba(15,40,55,0.35)]"><CardHeader><CardTitle className="font-serif text-xl">Directorio autorizado</CardTitle><CardDescription>La desactivación conserva la trazabilidad y bloquea nuevas consultas.</CardDescription></CardHeader><CardContent className="space-y-2">
              {authorizedUsers.data?.length ? authorizedUsers.data.map(authorised => <div key={authorised.telegramUserId} className="flex flex-col gap-3 rounded-xl border border-slate-100 p-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><p className="font-medium text-slate-800">{authorised.displayName || "Sin nombre"}</p><Badge className={authorised.isActive ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100" : "bg-slate-100 text-slate-600 hover:bg-slate-100"}>{authorised.isActive ? "Activo" : "Inactivo"}</Badge></div><p className="mt-1 text-xs text-slate-500">ID {authorised.telegramUserId}{authorised.username ? ` · @${authorised.username}` : ""} · {authorised.dailyLimit} consultas/día</p></div><Button variant="outline" size="sm" disabled={saveUser.isPending} onClick={() => saveUser.mutate({ telegramUserId: authorised.telegramUserId, displayName: authorised.displayName || undefined, username: authorised.username || undefined, dailyLimit: authorised.dailyLimit, isActive: !authorised.isActive })}>{authorised.isActive ? "Desactivar" : "Activar"}</Button></div>) : <EmptyState icon={UsersRound} text="No hay usuarios autorizados. Añade el primero desde el formulario." />}
            </CardContent></Card>
          </section>
        </>
      )}

      {section === "activity" && (
        <>
          <SectionHeading eyebrow="Trazabilidad" title="Auditoría y alertas" description="La auditoría conserva metadatos mínimos. No persiste números de documento ni respuestas completas de APIperú." />
          <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
            <Card className="border-white/80 bg-white/90 shadow-[0_18px_50px_-30px_rgba(15,40,55,0.35)]"><CardHeader><CardTitle className="font-serif text-xl">Consultas recientes</CardTitle><CardDescription>Tipo de documento, estado y código del proveedor.</CardDescription></CardHeader><CardContent className="space-y-2">{audits.data?.length ? audits.data.map(audit => <div key={audit.requestId} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-sky-50 text-sky-700"><Fingerprint className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-800">{audit.documentType.toUpperCase()} · {audit.displayName || audit.username || audit.telegramUserId}</p><p className="text-xs text-slate-500">{formatDate(audit.createdAt)}{audit.providerCode ? ` · ${audit.providerCode}` : ""}</p></div><Badge className={cn("border-0 ring-1", getStatusStyle(audit.status))}>{audit.status.replaceAll("_", " ")}</Badge></div>) : <EmptyState icon={Fingerprint} text="No se ha registrado actividad." />}</CardContent></Card>
            <Card className="border-white/80 bg-white/90 shadow-[0_18px_50px_-30px_rgba(15,40,55,0.35)]"><CardHeader><CardTitle className="font-serif text-xl">Eventos de seguridad</CardTitle><CardDescription>Los eventos críticos activan una alerta al responsable.</CardDescription></CardHeader><CardContent className="space-y-2">{securityEvents.data?.length ? securityEvents.data.map(event => <div key={event.id} className="rounded-xl border border-slate-100 p-3"><div className="flex items-center justify-between gap-2"><p className="text-sm font-medium text-slate-800">{event.eventType.replaceAll("_", " ")}</p><Badge className={event.severity === "critical" ? "bg-rose-100 text-rose-700 hover:bg-rose-100" : event.severity === "warning" ? "bg-amber-100 text-amber-700 hover:bg-amber-100" : "bg-slate-100 text-slate-600 hover:bg-slate-100"}>{event.severity}</Badge></div><p className="mt-1 text-xs text-slate-500">{formatDate(event.createdAt)}{event.telegramUserId ? ` · Usuario ${event.telegramUserId}` : ""}</p></div>) : <EmptyState icon={CircleAlert} text="No hay incidentes registrados." />}</CardContent></Card>
          </section>
        </>
      )}

      {section === "webhook" && (
        <>
          <SectionHeading eyebrow="Conexión segura" title="Webhook de Telegram" description="Conecta el bot únicamente después de configurar los secretos en el entorno seguro. Telegram llamará a esta URL con un encabezado secreto validado por el servidor." />
          <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
            <Card className="border-white/80 bg-white/90 shadow-[0_18px_50px_-30px_rgba(15,40,55,0.35)]"><CardHeader><div className="flex items-center justify-between gap-3"><div><CardTitle className="font-serif text-xl">Estado de la conexión</CardTitle><CardDescription>La URL no contiene secretos ni tokens.</CardDescription></div><Badge className={webhook.data?.secretsConfigured ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100" : "bg-amber-100 text-amber-700 hover:bg-amber-100"}>{webhook.data?.secretsConfigured ? "Secretos listos" : "Faltan secretos"}</Badge></div></CardHeader><CardContent className="space-y-5">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Endpoint protegido</p><code className="block min-w-0 break-all text-xs leading-5 text-slate-700">{webhook.data?.webhookDisplayUrl || "Disponible al publicar en un dominio HTTPS y configurar los secretos"}</code><p className="mt-2 text-xs text-slate-500">La parte secreta de la ruta no se expone en esta interfaz.</p></div>
              <div className="grid gap-3 sm:grid-cols-2"><MiniStatus label="Última configuración" value={formatDate(webhook.data?.lastConfiguredAt)} icon={Clock3} /><MiniStatus label="Estado reportado" value={webhook.data?.lastStatus || "Pendiente"} icon={Gauge} /></div>
              <Button className="w-full bg-[#0b2635] hover:bg-[#10384c]" disabled={configureWebhook.isPending || !webhook.data?.secretsConfigured} onClick={() => configureWebhook.mutate({ publicOrigin })}>{configureWebhook.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Webhook className="mr-2 h-4 w-4" />}{configureWebhook.isPending ? "Registrando con Telegram…" : "Configurar webhook ahora"}</Button>
            </CardContent></Card>
            <Card className="border-white/80 bg-[linear-gradient(160deg,#fffdf7,#f8f4e8)] shadow-[0_18px_50px_-30px_rgba(15,40,55,0.35)]"><CardHeader><CardTitle className="font-serif text-xl">Secuencia de conexión</CardTitle><CardDescription>El panel no solicita ni muestra credenciales.</CardDescription></CardHeader><CardContent className="space-y-4"><ConnectionStep number="01" title="Configura los secretos" description="Añade el token de BotFather, el token de APIperú y los dos secretos internos en el entorno seguro." /><ConnectionStep number="02" title="Autoriza a tu equipo" description="Añade IDs de Telegram y define límites antes de activar consultas." /><ConnectionStep number="03" title="Registra el webhook" description="Pulsa el botón de configuración. Telegram enviará actualizaciones al endpoint protegido." /><ConnectionStep number="04" title="Verifica el flujo" description="Envía /start al bot desde una cuenta autorizada y revisa la actividad." /></CardContent></Card>
          </section>
          <section className="mt-5"><Card className="border-white/80 bg-white/90 shadow-[0_18px_50px_-30px_rgba(15,40,55,0.35)]"><CardHeader><CardTitle className="font-serif text-xl">Controles operativos</CardTitle><CardDescription>Estos valores regulan el comportamiento del servicio sin almacenar secretos.</CardDescription></CardHeader><CardContent><div className="grid gap-5 md:grid-cols-2 xl:grid-cols-5"><div className="flex items-center justify-between rounded-xl border border-slate-100 p-3 xl:col-span-1"><Label htmlFor="service-enabled" className="text-sm font-medium">Servicio activo</Label><Switch id="service-enabled" checked={settingsForm.isEnabled} onCheckedChange={value => setSettingsForm({ ...settingsForm, isEnabled: value })} /></div><Field label="Límite predeterminado"><Input type="number" min={1} value={settingsForm.defaultDailyLimit} onChange={event => setSettingsForm({ ...settingsForm, defaultDailyLimit: Number(event.target.value) || 1 })} /></Field><Field label="Umbral de intentos"><Input type="number" min={1} value={settingsForm.unauthorizedAlertThreshold} onChange={event => setSettingsForm({ ...settingsForm, unauthorizedAlertThreshold: Number(event.target.value) || 1 })} /></Field><Field label="Ventana (minutos)"><Input type="number" min={1} value={settingsForm.alertWindowMinutes} onChange={event => setSettingsForm({ ...settingsForm, alertWindowMinutes: Number(event.target.value) || 1 })} /></Field><Field label="Alerta de cuota (%)"><Input type="number" min={10} max={100} value={settingsForm.quotaWarningPercent} onChange={event => setSettingsForm({ ...settingsForm, quotaWarningPercent: Number(event.target.value) || 10 })} /></Field></div><div className="mt-5 flex justify-end"><Button onClick={() => saveSettings.mutate(settingsForm)} disabled={saveSettings.isPending}>{saveSettings.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <SlidersHorizontal className="mr-2 h-4 w-4" />}Guardar controles</Button></div></CardContent></Card></section>
        </>
      )}
    </div>
  );

  return <DashboardLayout>{content}</DashboardLayout>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label className="text-sm font-medium text-slate-700">{label}</Label>{children}</div>;
}

function EmptyState({ icon: Icon, text }: { icon: typeof Clock3; text: string }) {
  return <div className="grid min-h-36 place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-6 text-center"><div><Icon className="mx-auto h-5 w-5 text-slate-400" /><p className="mt-2 text-sm text-slate-500">{text}</p></div></div>;
}

function SecurityLine({ label, active }: { label: string; active: boolean }) {
  return <div className="flex items-center gap-3"><span className={cn("grid h-6 w-6 place-items-center rounded-full", active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400")}><Check className="h-3.5 w-3.5" /></span><span className="text-sm text-slate-700">{label}</span></div>;
}

function MiniStatus({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Clock3 }) {
  return <div className="rounded-xl border border-slate-100 p-3"><div className="flex items-center gap-2 text-slate-500"><Icon className="h-3.5 w-3.5" /><p className="text-xs font-medium">{label}</p></div><p className="mt-2 text-sm font-medium text-slate-800">{value}</p></div>;
}

function ConnectionStep({ number, title, description }: { number: string; title: string; description: string }) {
  return <div className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#0b2635] text-[10px] font-bold tracking-wider text-amber-200">{number}</span><div><p className="text-sm font-semibold text-slate-800">{title}</p><p className="mt-0.5 text-sm leading-5 text-slate-500">{description}</p></div></div>;
}
