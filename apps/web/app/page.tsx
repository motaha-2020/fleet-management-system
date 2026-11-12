"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";

export default function Home() {
  const { user, ready } = useSession();
  const { t } = useI18n();
  const router = useRouter();
  useEffect(() => {
    if (!ready) return;
    if (!user) router.replace("/login");
    else router.replace(user.role === "platform_admin" ? "/platform/tenants" : "/vehicles");
  }, [ready, user, router]);
  return <div className="p-10 text-center text-muted">{t.common.loading}</div>;
}
