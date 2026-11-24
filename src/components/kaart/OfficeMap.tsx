"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import type { OfficeView } from "@/lib/offices/collect";
import { SOURCE_LABEL, KIND_LABEL } from "./labels";

type Props = {
  center: { lat: number; lon: number } | null;
  radiusKm: number;
  offices: OfficeView[];
  selectedId: number | null;
  hoverId: number | null;
  onSelect: (id: number | null) => void;
};

/** Kleuren uit de huisstijl: navy voor banken, goud voor verzekeringen. */
const COLOR: Record<OfficeView["sector"], string> = { bank: "#1b1845", verzekeringen: "#e0a410" };

function markerIcon(o: OfficeView, active: boolean) {
  const size = active ? 30 : o.openJobs > 0 ? 24 : 18;
  const ring = o.verified ? "box-shadow:0 0 0 2px #fff,0 0 0 4px " + COLOR[o.sector] + "33;" : "box-shadow:0 1px 4px rgba(27,24,69,.35);";
  const border = o.approximate ? "border:2px dashed #fff;" : "border:2px solid #fff;";
  const jobs = o.openJobs > 0 ? `<span style="position:absolute;top:-7px;right:-7px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:#15803d;color:#fff;font:600 10px/16px Inter,system-ui,sans-serif;text-align:center;box-shadow:0 0 0 2px #fff">${o.openJobs}</span>` : "";
  return L.divIcon({
    className: "office-pin",
    html: `<div style="position:relative;width:${size}px;height:${size}px;border-radius:50%;background:${COLOR[o.sector]};${border}${ring}opacity:${o.approximate ? 0.8 : 1};transition:width .15s,height .15s">${jobs}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2 - 4],
  });
}

const homeIcon = L.divIcon({
  className: "office-home",
  html: `<div style="width:34px;height:34px;display:flex;align-items:center;justify-content:center;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#febc14;border:3px solid #fff;box-shadow:0 2px 10px rgba(27,24,69,.4)"><div style="transform:rotate(45deg);width:10px;height:10px;border-radius:50%;background:#1b1845"></div></div>`,
  iconSize: [34, 34],
  iconAnchor: [17, 34],
});

/** Vliegt naar het nieuwe middelpunt en past de zoom aan de straal aan. */
function FitToRadius({ center, radiusKm }: { center: { lat: number; lon: number } | null; radiusKm: number }) {
  const map = useMap();
  const key = center ? `${center.lat},${center.lon},${radiusKm}` : "none";
  useEffect(() => {
    if (!center) return;
    // Cirkel nog niet op de kaart: bounds zelf berekenen (vierkant van 2 × straal rond het middelpunt).
    const bounds = L.latLng(center.lat, center.lon).toBounds(radiusKm * 2 * 1000);
    map.flyToBounds(bounds, { padding: [24, 24], duration: 0.8 });
  }, [key, map]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Opent de popup van het geselecteerde kantoor en schuift ernaartoe. */
function FocusSelected({ offices, selectedId, markers }: { offices: OfficeView[]; selectedId: number | null; markers: RefObject<Map<number, L.Marker>> }) {
  const map = useMap();
  useEffect(() => {
    if (selectedId === null) return;
    const o = offices.find((x) => x.id === selectedId);
    const m = markers.current.get(selectedId);
    if (!o || !m) return;
    map.panTo([o.lat, o.lng], { animate: true, duration: 0.5 });
    m.openPopup();
  }, [selectedId, offices, map, markers]);
  return null;
}

export default function OfficeMap({ center, radiusKm, offices, selectedId, hoverId, onSelect }: Props) {
  const markers = useRef(new Map<number, L.Marker>());
  const initial = useMemo<[number, number]>(() => (center ? [center.lat, center.lon] : [51.05, 4.4]), []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <MapContainer center={initial} zoom={center ? 11 : 8} zoomControl={false} className="h-full w-full" attributionControl>
      {/* OpenStreetMap-tegels (geen key nodig), gedempt via CSS zodat de kantoren eruit springen. */}
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" className="basemap" maxZoom={19} />
      <FitToRadius center={center} radiusKm={radiusKm} />
      <FocusSelected offices={offices} selectedId={selectedId} markers={markers} />
      {center && (
        <>
          <Circle center={[center.lat, center.lon]} radius={radiusKm * 1000} pathOptions={{ color: "#1b1845", weight: 1.5, dashArray: "6 6", fillColor: "#1b1845", fillOpacity: 0.04 }} />
          <Marker position={[center.lat, center.lon]} icon={homeIcon} zIndexOffset={1000} />
        </>
      )}
      {offices.map((o) => (
        <Marker
          key={o.id}
          position={[o.lat, o.lng]}
          icon={markerIcon(o, o.id === selectedId || o.id === hoverId)}
          zIndexOffset={o.id === selectedId || o.id === hoverId ? 900 : o.openJobs > 0 ? 500 : 0}
          ref={(m) => {
            if (m) markers.current.set(o.id, m);
            else markers.current.delete(o.id);
          }}
          eventHandlers={{ click: () => onSelect(o.id), popupclose: () => onSelect(null) }}
        >
          <Popup closeButton={false} maxWidth={300} className="office-popup">
            <div className="text-ink" style={{ fontFamily: "var(--font-sans)" }}>
              <div className="flex items-start gap-2">
                <span className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COLOR[o.sector] }} />
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold leading-tight text-navy">{o.name}</div>
                  <div className="text-[11.5px] text-ink-soft mt-0.5">
                    {KIND_LABEL[o.kind]}
                    {o.brand ? ` · ${o.brand}` : ""} · {o.distanceKm} km
                  </div>
                </div>
              </div>
              {o.address && <div className="mt-2 text-[12.5px] text-ink-soft">{o.address}</div>}
              <div className="mt-2 flex flex-wrap gap-1">
                {o.openJobs > 0 && (
                  <span className="rounded-full bg-[#dcfce7] px-2 py-0.5 text-[11px] font-medium text-ok">
                    {o.openJobs} vacature{o.openJobs === 1 ? "" : "s"}
                    {o.brandSite ? " bij het merk" : ""}
                  </span>
                )}
                {o.sources.map((s) => (
                  <span key={s} className="rounded-full bg-paper-soft px-2 py-0.5 text-[11px] text-ink-soft">
                    {SOURCE_LABEL[s] ?? s}
                  </span>
                ))}
                {o.verified && <span className="rounded-full bg-gold-soft px-2 py-0.5 text-[11px] font-medium text-[#8a6300]">bevestigd</span>}
                {o.approximate && <span className="rounded-full bg-paper-soft px-2 py-0.5 text-[11px] text-ink-faint">ligging bij benadering</span>}
              </div>
              <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[12px] font-medium">
                {o.website && (
                  <a href={o.website} target="_blank" rel="noreferrer" className="text-navy underline decoration-gold decoration-2 underline-offset-2">
                    website
                  </a>
                )}
                {o.careersUrl && (
                  <a href={o.careersUrl} target="_blank" rel="noreferrer" className="text-navy underline decoration-gold decoration-2 underline-offset-2">
                    vacatures
                  </a>
                )}
                {o.phone && (
                  <a href={`tel:${o.phone.replace(/\s/g, "")}`} className="text-ink-soft">
                    {o.phone}
                  </a>
                )}
                {(o.contactEmail ?? o.email) && (
                  <a href={`mailto:${o.contactEmail ?? o.email}`} className="text-ink-soft break-all">
                    {o.contactName ? `${o.contactName} · ` : ""}
                    {o.contactEmail ?? o.email}
                  </a>
                )}
                <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${o.name} ${o.address ?? ""}`)}`} target="_blank" rel="noreferrer" className="text-ink-soft">
                  Google Maps ↗
                </a>
              </div>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
