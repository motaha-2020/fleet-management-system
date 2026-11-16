"use client";
import { useEffect, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";

export interface MapPoint { id: string; lat: number; lng: number; accuracyM: number | null; title: string; lines: string[]; flagged?: boolean }

/** A link that opens one point on OpenStreetMap (new tab). */
export const osmLink = (lat: number, lng: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;

/**
 * Owner decision (14 Nov 2026): where each fuel entry was made (the fuel station), on a map. OpenStreetMap tiles
 * (free, no key). Each entry is a dot with its accuracy circle; flagged entries are red. Leaflet is loaded only in
 * the browser.
 */
export function FuelMap({ points, height = 420 }: { points: MapPoint[]; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !box.current) return;
      map.current?.remove();
      const m = L.map(box.current, { scrollWheelZoom: false });
      map.current = m;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, attribution: "&copy; OpenStreetMap contributors",
      }).addTo(m);
      const bounds: [number, number][] = [];
      for (const p of points) {
        const color = p.flagged ? "#C0392B" : "#1F6FEB";
        if (p.accuracyM && p.accuracyM > 20) L.circle([p.lat, p.lng], { radius: p.accuracyM, color, weight: 1, fillOpacity: 0.08 }).addTo(m);
        const popup = document.createElement("div");
        const strong = document.createElement("strong");
        strong.textContent = p.title;
        popup.appendChild(strong);
        for (const line of p.lines) {
          const d = document.createElement("div");
          d.textContent = line;
          popup.appendChild(d);
        }
        L.circleMarker([p.lat, p.lng], { radius: 7, color: "#fff", weight: 2, fillColor: color, fillOpacity: 1 }).bindPopup(popup).addTo(m);
        bounds.push([p.lat, p.lng]);
      }
      if (bounds.length) m.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
      else m.setView([30.0444, 31.2357], 6); // Cairo, when there is nothing to show yet
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, [points]);

  return <div ref={box} style={{ height }} className="w-full overflow-hidden rounded-lg border border-line" data-testid="fuel-map" />;
}
