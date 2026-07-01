import React, { useState, useMemo, useRef, useEffect } from "react";
import { useSim } from "../context/SimContext";
import { useTheme } from "../context/ThemeContext";
import type { Airport } from "../data/airports";
import {
  Search, Plus, Pencil, Trash2, X, ChevronLeft, ChevronRight,
  AlertTriangle, Warehouse, Upload, FileText, CheckCircle2, MapPin, Clock, Globe
} from "lucide-react";
import { api } from "../services/api";

const ROWS_PER_PAGE = 10;
type ModalMode = "create" | "edit" | null;

interface FormData {
  code: string;
  city: string;
  country: string;
  continent: "America" | "Europa" | "Asia";
  timezone: string;
  lat: string;
  lng: string;
  capacity: string;
}

const emptyForm: FormData = {
  code: "", city: "", country: "", continent: "America",
  timezone: "UTC-5", lat: "", lng: "", capacity: "600",
};

const CONTINENTS: { value: Airport["continent"]; label: string }[] = [
  { value: "America", label: "América" },
  { value: "Europa", label: "Europa" },
  { value: "Asia", label: "Asia" },
];

const TIMEZONES = [
  "UTC-8", "UTC-7", "UTC-6", "UTC-5", "UTC-4", "UTC-3", "UTC-2", "UTC-1",
  "UTC+0", "UTC+1", "UTC+2", "UTC+3", "UTC+4", "UTC+5", "UTC+5:30", "UTC+6",
  "UTC+7", "UTC+8", "UTC+9", "UTC+10", "UTC+11", "UTC+12",
];

function getBarColor(pct: number) {
  if (pct < 50) return "bg-green-500";
  if (pct < 80) return "bg-amber-500";
  return "bg-red-500";
}

function getStatusBadge(pct: number, isDark: boolean) {
  if (pct < 50) return isDark ? "bg-green-500/15 text-green-400" : "bg-green-100 text-green-700";
  if (pct < 80) return isDark ? "bg-amber-500/15 text-amber-400" : "bg-amber-100 text-amber-700";
  return isDark ? "bg-red-500/15 text-red-400" : "bg-red-100 text-red-700";
}

export function AirportsPanel() {
  const { state, addAirport, updateAirport, deleteAirport, batchImportAirports } = useSim();
  const { isDark } = useTheme();
  const [airportsList, setAirportsList] = useState<Airport[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [editCode, setEditCode] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<Airport | null>(null);
  const [filterContinent, setFilterContinent] = useState<string>("all");
  const fileRef = useRef<HTMLInputElement>(null);
  const [importResult, setImportResult] = useState<{ count: number; visible: boolean } | null>(null);

  useEffect(() => {
    fetchAirports();
  }, []);

  const fetchAirports = async () => {
    setLoading(true);
    try {
      const data = await api.getAirports();
      // Map backend entity to frontend Airport interface
      const mapped = data.map((a: any) => ({
        code: a.oaci,
        city: a.ciudad,
        country: a.pais,
        continent: a.continente === "Europe" ? "Europa" : (a.continente || "America"),
        timezone: a.gmt >= 0 ? `UTC+${a.gmt}` : `UTC${a.gmt}`,
        lat: a.latitud,
        lng: a.longitud,
        warehouseCapacity: a.capacidadAlmacen,
        currentStock: a.stockActual || 0
      }));
      setAirportsList(mapped);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    let list = airportsList;
    if (filterContinent !== "all") {
      list = list.filter(a => a.continent === filterContinent);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(a =>
        a.code.toLowerCase().includes(q) ||
        a.city.toLowerCase().includes(q) ||
        a.country.toLowerCase().includes(q)
      );
    }
    return list;
  }, [airportsList, search, filterContinent]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE));
  const pageData = filtered.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE);

  // Validation
  const validate = (): boolean => {
    const e: Partial<Record<keyof FormData, string>> = {};
    if (!form.code.trim()) e.code = "Código OACI es requerido";
    else if (!/^[A-Z]{3,4}$/i.test(form.code.trim())) e.code = "Código OACI debe ser 3-4 letras";
    else if (modalMode === "create") {
      const dup = airportsList.find(a => a.code === form.code.trim().toUpperCase());
      if (dup) e.code = "Este código OACI ya está registrado";
    }
    if (!form.city.trim()) e.city = "Ciudad es requerida";
    if (!form.country.trim()) e.country = "País es requerido";
    if (!form.timezone) e.timezone = "Huso horario es requerido";
    if (!form.lat.trim()) e.lat = "Latitud es requerida";
    else {
      const lat = parseFloat(form.lat);
      if (isNaN(lat) || lat < -90 || lat > 90) e.lat = "Latitud debe estar entre -90 y 90";
    }
    if (!form.lng.trim()) e.lng = "Longitud es requerida";
    else {
      const lng = parseFloat(form.lng);
      if (isNaN(lng) || lng < -180 || lng > 180) e.lng = "Longitud debe estar entre -180 y 180";
    }
    if (!form.capacity.trim()) e.capacity = "Capacidad es requerida";
    else {
      const cap = parseInt(form.capacity);
      if (isNaN(cap) || cap < 1) e.capacity = "Capacidad debe ser mayor a 0";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const openCreate = () => {
    setForm(emptyForm);
    setEditCode(null);
    setErrors({});
    setModalMode("create");
  };

  const openEdit = (a: Airport) => {
    setForm({
      code: a.code,
      city: a.city,
      country: a.country,
      continent: a.continent,
      timezone: a.timezone || "UTC+0",
      lat: String(a.lat),
      lng: String(a.lng),
      capacity: String(a.warehouseCapacity),
    });
    setEditCode(a.code);
    setErrors({});
    setModalMode("edit");
  };

  const handleSave = async () => {
    if (!validate()) return;
    const lat = parseFloat(form.lat);
    const lng = parseFloat(form.lng);
    const cap = parseInt(form.capacity);
    const gmtStr = form.timezone.replace("UTC", "");
    const gmt = parseInt(gmtStr) || 0;

    const payload = {
      oaci: form.code.trim().toUpperCase(),
      ciudad: form.city.trim(),
      pais: form.country.trim(),
      continente: form.continent === "Europa" ? "Europe" : form.continent,
      gmt: gmt,
      capacidadAlmacen: cap,
      latitud: lat,
      longitud: lng
    };

    try {
      if (modalMode === "create") {
        await api.createAirport(payload);
      } else if (modalMode === "edit" && editCode) {
        await api.updateAirport(editCode, payload);
      }
      setModalMode(null);
      fetchAirports();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDelete = (a: Airport) => {
    setDeleteConfirm(a);
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await api.deleteAirport(deleteConfirm.code);
      setDeleteConfirm(null);
      fetchAirports();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split("\n").filter(l => l.trim().length > 0);
      const count = batchImportAirports(lines);
      setImportResult({ count, visible: true });
      setTimeout(() => setImportResult(null), 5000);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const getContinentLabel = (c: string) => CONTINENTS.find(ct => ct.value === c)?.label || c;

  // Styles (matching OperariosPanel)
  const cardBg = isDark ? "bg-[#0f172a] border-[#1e293b]" : "bg-white border-[#cbd5e1]";
  const thBg = isDark ? "bg-[#1e293b]/60" : "bg-[#e2e8f0]";
  const rowHover = isDark ? "hover:bg-[#1e293b]/40" : "hover:bg-[#f1f5f9]";
  const textPrimary = isDark ? "text-white" : "text-[#0f172a]";
  const textSecondary = isDark ? "text-[#94a3b8]" : "text-[#64748b]";
  const inputCls = `w-full rounded-lg text-[13px] px-3 py-2 border transition-colors focus:outline-none ${
    isDark
      ? "bg-[#1e293b] border-[#334155] text-white placeholder:text-white/30 focus:border-cyan-500/50"
      : "bg-[#f8fafc] border-[#cbd5e1] text-[#0f172a] placeholder:text-[#94a3b8] focus:border-blue-500"
  }`;
  const labelCls = `block text-[12px] mb-1 ${textSecondary}`;
  const errorCls = "text-red-400 text-[11px] mt-0.5";
  const modalBg = isDark ? "bg-[#0f172a] border-[#1e293b]" : "bg-white border-[#cbd5e1]";
  const overlayBg = "bg-black/60";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Warehouse className={`w-5 h-5 ${isDark ? "text-cyan-400" : "text-blue-700"}`} />
          <h1 className={`text-[20px] ${textPrimary}`}>Aeropuertos Tasf.B2B</h1>
          <span className={`text-[12px] px-2 py-0.5 rounded-full ${isDark ? "bg-[#1e293b] text-[#94a3b8]" : "bg-[#e2e8f0] text-[#64748b]"}`}>
            {airportsList.length} registrados
          </span>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          {/* Filter continent */}
          <select
            value={filterContinent}
            onChange={e => { setFilterContinent(e.target.value); setPage(0); }}
            className={`rounded-lg text-[12px] px-2 py-1.5 border ${
              isDark
                ? "bg-[#1e293b] border-[#334155] text-white"
                : "bg-white border-[#cbd5e1] text-[#0f172a]"
            }`}
          >
            <option value="all">Todos</option>
            {CONTINENTS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <div className="relative flex-1 sm:flex-none">
            <Search className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${textSecondary}`} />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
              placeholder="Buscar por OACI, ciudad o país..."
              className={`pl-8 pr-3 py-1.5 rounded-lg text-[12px] border w-full sm:w-64 ${
                isDark
                  ? "bg-[#1e293b] border-[#334155] text-white placeholder:text-white/30"
                  : "bg-white border-[#cbd5e1] text-[#0f172a] placeholder:text-[#94a3b8]"
              }`}
            />
          </div>
          <button
            onClick={openCreate}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-white transition-colors shrink-0 ${isDark ? "bg-cyan-600 hover:bg-cyan-500" : "bg-blue-600 hover:bg-blue-700"}`}
          >
            <Plus className="w-3.5 h-3.5" /> Nuevo Aeropuerto
          </button>
        </div>
      </div>

      {/* Table */}
      <div className={`border rounded-xl overflow-hidden ${cardBg}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className={thBg}>
                <th className={`text-left px-3 py-2.5 ${textSecondary}`}>OACI</th>
                <th className={`text-left px-3 py-2.5 ${textSecondary}`}>Ciudad</th>
                <th className={`text-left px-3 py-2.5 ${textSecondary} hidden md:table-cell`}>País</th>
                <th className={`text-left px-3 py-2.5 ${textSecondary} hidden lg:table-cell`}>Continente</th>
                <th className={`text-left px-3 py-2.5 ${textSecondary} hidden lg:table-cell`}>Huso Horario</th>
                <th className={`text-left px-3 py-2.5 ${textSecondary}`}>Capacidad</th>
                <th className={`text-left px-3 py-2.5 ${textSecondary} hidden xl:table-cell`}>Coords</th>
                <th className={`text-center px-3 py-2.5 ${textSecondary}`}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {pageData.length === 0 ? (
                <tr>
                  <td colSpan={8} className={`text-center py-12 ${textSecondary}`}>
                    {search ? "No se encontraron aeropuertos" : "No hay aeropuertos registrados"}
                  </td>
                </tr>
              ) : pageData.map(a => {
                const as_ = state.airports[a.code];
                const stock = as_?.currentStock || 0;
                const cap = as_?.capacity || a.warehouseCapacity;
                const pct = cap > 0 ? (stock / cap) * 100 : 0;
                return (
                  <tr key={a.code} className={`border-t ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"} ${rowHover} transition-colors`}>
                    <td className={`px-3 py-2.5`}>
                      <span className={`px-2 py-0.5 rounded text-[11px] font-mono ${isDark ? "bg-cyan-500/10 text-cyan-400" : "bg-blue-600/10 text-blue-800"}`}>
                        {a.code}
                      </span>
                    </td>
                    <td className={`px-3 py-2.5 ${textPrimary}`}>{a.city}</td>
                    <td className={`px-3 py-2.5 ${textSecondary} hidden md:table-cell`}>{a.country}</td>
                    <td className={`px-3 py-2.5 hidden lg:table-cell`}>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] ${
                        a.continent === "America"
                          ? isDark ? "bg-blue-500/15 text-blue-400" : "bg-blue-100 text-blue-700"
                          : a.continent === "Europa"
                          ? isDark ? "bg-purple-500/15 text-purple-400" : "bg-purple-100 text-purple-700"
                          : isDark ? "bg-amber-500/15 text-amber-400" : "bg-amber-100 text-amber-700"
                      }`}>
                        {getContinentLabel(a.continent)}
                      </span>
                    </td>
                    <td className={`px-3 py-2.5 ${textSecondary} hidden lg:table-cell font-mono text-[11px]`}>
                      {a.timezone || "—"}
                    </td>
                    <td className={`px-3 py-2.5 ${textPrimary}`}>{cap.toLocaleString()}</td>
                    <td className={`px-3 py-2.5 ${textSecondary} hidden xl:table-cell font-mono text-[10px]`}>
                      {a.lat.toFixed(2)}, {a.lng.toFixed(2)}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => openEdit(a)}
                          title="Editar"
                          className={`p-1.5 rounded-lg transition-colors ${isDark ? "hover:bg-[#334155] text-amber-400" : "hover:bg-[#e2e8f0] text-amber-600"}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(a)}
                          title="Eliminar"
                          className={`p-1.5 rounded-lg transition-colors ${isDark ? "hover:bg-[#334155] text-red-400" : "hover:bg-[#e2e8f0] text-red-600"}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {filtered.length > ROWS_PER_PAGE && (
          <div className={`flex items-center justify-between px-3 py-2 border-t ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"}`}>
            <span className={`text-[11px] ${textSecondary}`}>
              {page * ROWS_PER_PAGE + 1}–{Math.min((page + 1) * ROWS_PER_PAGE, filtered.length)} de {filtered.length}
            </span>
            <div className="flex items-center gap-1">
              <button
                disabled={page === 0}
                onClick={() => setPage(p => p - 1)}
                className={`p-1 rounded transition-colors disabled:opacity-30 ${isDark ? "hover:bg-[#334155] text-white" : "hover:bg-[#e2e8f0] text-[#0f172a]"}`}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className={`text-[11px] px-2 ${textSecondary}`}>{page + 1} / {totalPages}</span>
              <button
                disabled={page >= totalPages - 1}
                onClick={() => setPage(p => p + 1)}
                className={`p-1 rounded transition-colors disabled:opacity-30 ${isDark ? "hover:bg-[#334155] text-white" : "hover:bg-[#e2e8f0] text-[#0f172a]"}`}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Batch Import Section */}
      <div className={`border rounded-xl overflow-hidden ${cardBg}`}>
        <div className={`px-5 py-4 border-b ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"}`}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isDark ? "bg-cyan-500/10" : "bg-blue-600/10"}`}>
              <Upload className={`w-5 h-5 ${isDark ? "text-cyan-400" : "text-blue-700"}`} />
            </div>
            <div>
              <h3 className={`text-[14px] ${textPrimary}`}>Importación en Lote</h3>
              <p className={`text-[11px] ${textSecondary}`}>Carga múltiples aeropuertos desde un archivo de texto (.txt o .csv)</p>
            </div>
          </div>
        </div>
        <div className="px-5 py-4">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
            {/* Left: Info */}
            <div className="flex-1 space-y-3">
              <div className={`text-[12px] ${textSecondary}`}>
                <p className="mb-2">El archivo debe seguir el formato <span className={isDark ? "text-cyan-400" : "text-blue-700"}>PDDS 25-2</span>. Cada línea representa un aeropuerto:</p>
                <div className={`rounded-lg p-3 font-mono text-[11px] ${isDark ? "bg-[#1e293b] text-cyan-300" : "bg-[#f1f5f9] text-blue-800"}`}>
                  01 SKBO Bogota &nbsp;&nbsp;Colombia &nbsp;&nbsp;bogo -5 430 Latitude: 4°42'0"N Longitude: 74°4'0"W
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <div className="flex items-center gap-1.5">
                  <FileText className={`w-3.5 h-3.5 ${textSecondary}`} />
                  <span className={`text-[11px] ${textSecondary}`}>Formatos: .txt, .csv</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Globe className={`w-3.5 h-3.5 ${textSecondary}`} />
                  <span className={`text-[11px] ${textSecondary}`}>Coordenadas DMS o decimales</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <MapPin className={`w-3.5 h-3.5 ${textSecondary}`} />
                  <span className={`text-[11px] ${textSecondary}`}>Detección automática de continente</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Clock className={`w-3.5 h-3.5 ${textSecondary}`} />
                  <span className={`text-[11px] ${textSecondary}`}>Huso horario desde el offset UTC</span>
                </div>
              </div>
            </div>

            {/* Right: Upload button */}
            <div className="flex flex-col items-center gap-2">
              <input ref={fileRef} type="file" accept=".txt,.csv" onChange={handleFileUpload} className="hidden" />
              <button
                onClick={() => fileRef.current?.click()}
                className={`flex items-center gap-2 px-5 py-3 rounded-xl text-[13px] transition-all ${
                  isDark
                    ? "bg-gradient-to-r from-cyan-600/20 to-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:from-cyan-600/30 hover:to-cyan-500/20"
                    : "bg-gradient-to-r from-blue-600/20 to-blue-500/10 border border-blue-500/30 text-blue-700 hover:from-blue-600/30 hover:to-blue-500/20"
                }`}
              >
                <Upload className="w-4 h-4" />
                Seleccionar Archivo
              </button>
              {importResult?.visible && (
                <div className="flex items-center gap-1.5 animate-fade-in">
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                  <span className="text-[11px] text-green-400">{importResult.count} aeropuertos importados</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Create / Edit Modal */}
      {modalMode && (
        <div className={`fixed inset-0 z-[60] flex items-center justify-center ${overlayBg}`} onClick={() => setModalMode(null)}>
          <div className={`border rounded-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto ${modalBg}`} onClick={e => e.stopPropagation()}>
            <div className={`flex items-center justify-between px-5 py-3.5 border-b ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"}`}>
              <h2 className={`text-[15px] ${textPrimary}`}>
                {modalMode === "create" ? "Registrar Aeropuerto" : "Modificar Aeropuerto"}
              </h2>
              <button onClick={() => setModalMode(null)} className={`p-1 rounded-lg transition-colors ${isDark ? "hover:bg-[#334155] text-white/60" : "hover:bg-[#e2e8f0] text-[#64748b]"}`}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-3">
              {/* Code + City */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Código OACI *</label>
                  <input
                    value={form.code}
                    onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                    placeholder="SKBO"
                    maxLength={4}
                    disabled={modalMode === "edit"}
                    className={`${inputCls} ${modalMode === "edit" ? "opacity-50 cursor-not-allowed" : ""}`}
                  />
                  {errors.code && <p className={errorCls}>{errors.code}</p>}
                </div>
                <div>
                  <label className={labelCls}>Ciudad *</label>
                  <input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder="Bogotá" className={inputCls} />
                  {errors.city && <p className={errorCls}>{errors.city}</p>}
                </div>
              </div>

              {/* Country + Continent */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>País *</label>
                  <input value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} placeholder="Colombia" className={inputCls} />
                  {errors.country && <p className={errorCls}>{errors.country}</p>}
                </div>
                <div>
                  <label className={labelCls}>Continente *</label>
                  <select
                    value={form.continent}
                    onChange={e => setForm(f => ({ ...f, continent: e.target.value as FormData["continent"] }))}
                    className={inputCls}
                  >
                    {CONTINENTS.map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Timezone + Capacity */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Huso Horario *</label>
                  <select
                    value={form.timezone}
                    onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))}
                    className={inputCls}
                  >
                    {TIMEZONES.map(tz => (
                      <option key={tz} value={tz}>{tz}</option>
                    ))}
                  </select>
                  {errors.timezone && <p className={errorCls}>{errors.timezone}</p>}
                </div>
                <div>
                  <label className={labelCls}>Capacidad del almacén *</label>
                  <input value={form.capacity} onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))} placeholder="600" type="number" className={inputCls} />
                  {errors.capacity && <p className={errorCls}>{errors.capacity}</p>}
                </div>
              </div>

              {/* Lat + Lng */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Latitud *</label>
                  <input value={form.lat} onChange={e => setForm(f => ({ ...f, lat: e.target.value }))} placeholder="-90 a 90" type="number" step="0.01" className={inputCls} />
                  {errors.lat && <p className={errorCls}>{errors.lat}</p>}
                </div>
                <div>
                  <label className={labelCls}>Longitud *</label>
                  <input value={form.lng} onChange={e => setForm(f => ({ ...f, lng: e.target.value }))} placeholder="-180 a 180" type="number" step="0.01" className={inputCls} />
                  {errors.lng && <p className={errorCls}>{errors.lng}</p>}
                </div>
              </div>
            </div>

            <div className={`flex items-center justify-end gap-2 px-5 py-3 border-t ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"}`}>
              <button
                onClick={() => setModalMode(null)}
                className={`px-4 py-1.5 rounded-lg text-[12px] border transition-colors ${
                  isDark ? "border-[#334155] text-white/70 hover:bg-[#1e293b]" : "border-[#cbd5e1] text-[#64748b] hover:bg-[#f1f5f9]"
                }`}
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                className={`px-4 py-1.5 rounded-lg text-[12px] text-white transition-colors ${isDark ? "bg-cyan-600 hover:bg-cyan-500" : "bg-blue-600 hover:bg-blue-700"}`}
              >
                {modalMode === "create" ? "Registrar" : "Guardar Cambios"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className={`fixed inset-0 z-[60] flex items-center justify-center ${overlayBg}`} onClick={() => setDeleteConfirm(null)}>
          <div className={`border rounded-xl w-full max-w-sm mx-4 ${modalBg}`} onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 text-center">
              <div className={`mx-auto w-10 h-10 rounded-full flex items-center justify-center mb-3 ${isDark ? "bg-red-500/15" : "bg-red-100"}`}>
                <AlertTriangle className={`w-5 h-5 ${isDark ? "text-red-400" : "text-red-600"}`} />
              </div>
              <h3 className={`text-[14px] mb-1 ${textPrimary}`}>Eliminar aeropuerto</h3>
              <p className={`text-[12px] ${textSecondary}`}>
                ¿Estás seguro de eliminar <span className={textPrimary}>{deleteConfirm.city} ({deleteConfirm.code})</span>? Esta acción no se puede deshacer.
              </p>
            </div>
            <div className={`flex items-center justify-center gap-2 px-5 py-3 border-t ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"}`}>
              <button
                onClick={() => setDeleteConfirm(null)}
                className={`px-4 py-1.5 rounded-lg text-[12px] border transition-colors ${
                  isDark ? "border-[#334155] text-white/70 hover:bg-[#1e293b]" : "border-[#cbd5e1] text-[#64748b] hover:bg-[#f1f5f9]"
                }`}
              >
                Cancelar
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-1.5 rounded-lg text-[12px] bg-red-600 hover:bg-red-500 text-white transition-colors"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
