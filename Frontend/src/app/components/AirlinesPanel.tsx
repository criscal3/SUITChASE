import React, { useState, useMemo, useEffect } from "react";
import { useTheme } from "../context/ThemeContext";
import { api } from "../services/api";
import { toast } from "sonner";
import {
  Search, Plus, Pencil, Trash2, X, ChevronLeft, ChevronRight,
  AlertTriangle, Building2, Eye, EyeOff, Mail, RefreshCw
} from "lucide-react";

const ROWS_PER_PAGE = 8;
type ModalMode = "create" | "edit" | null;

interface FormData {
  name: string;
  code: string;
  email: string;
  password: string;
}

const emptyForm: FormData = { name: "", code: "", email: "", password: "" };

export function AirlinesPanel() {
  const { isDark } = useTheme();
  const [airlines, setAirlines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<any | null>(null);

  useEffect(() => { fetchAirlines(); }, []);

  const fetchAirlines = async () => {
    setLoading(true);
    try {
      const data = await api.getAirlines();
      setAirlines(data);
    } catch (err: any) {
      toast.error("Error al cargar aerolíneas");
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return airlines;
    const q = search.toLowerCase();
    return airlines.filter(a =>
      (a.nombre || "").toLowerCase().includes(q) ||
      (a.codigo || "").toLowerCase().includes(q)
    );
  }, [airlines, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE));
  const pageData = filtered.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE);

  const validate = (): boolean => {
    const e: Partial<Record<keyof FormData, string>> = {};
    if (!form.name.trim()) e.name = "Nombre es requerido";
    if (!form.code.trim()) e.code = "Código OACI es requerido";
    else if (!/^[A-Z]{2,4}$/i.test(form.code.trim())) e.code = "Código debe ser 2-4 letras";
    else if (modalMode === "create") {
      if (airlines.find(a => a.codigo === form.code.trim().toUpperCase())) e.code = "Este código ya está registrado";
    }
    if (modalMode === "create") {
      if (!form.email.trim()) e.email = "Correo es requerido";
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = "Correo inválido";
      if (!form.password.trim()) e.password = "Contraseña es requerida";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const openCreate = () => {
    setForm(emptyForm);
    setEditId(null);
    setErrors({});
    setShowPassword(false);
    setModalMode("create");
  };

  const openEdit = (a: any) => {
    setForm({ name: a.nombre, code: a.codigo, email: "", password: "" });
    setEditId(a.id);
    setErrors({});
    setShowPassword(false);
    setModalMode("edit");
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      if (modalMode === "create") {
        await api.createAirline({
          nombre: form.name.trim(),
          codigo: form.code.trim().toUpperCase(),
          correo: form.email.trim(),
          password: form.password.trim(),
        });
        toast.success(`Aerolínea "${form.name.trim()}" registrada exitosamente`);
      } else if (modalMode === "edit" && editId !== null) {
        await api.updateAirline(editId, { nombre: form.name.trim() });
        toast.success("Aerolínea actualizada");
      }
      setModalMode(null);
      fetchAirlines();
    } catch (err: any) {
      toast.error(err.message || "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await api.deleteAirline(deleteConfirm.id);
      toast.success(`Aerolínea "${deleteConfirm.nombre}" eliminada`);
      setDeleteConfirm(null);
      fetchAirlines();
    } catch (err: any) {
      toast.error(err.message || "Error al eliminar");
    }
  };

  // Styles
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
          <Building2 className={`w-5 h-5 ${isDark ? "text-cyan-400" : "text-blue-700"}`} />
          <h1 className={`text-[20px] ${textPrimary}`}>Aerolíneas</h1>
          <span className={`text-[12px] px-2 py-0.5 rounded-full ${isDark ? "bg-[#1e293b] text-[#94a3b8]" : "bg-[#e2e8f0] text-[#64748b]"}`}>
            {loading ? "..." : airlines.length} registradas
          </span>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none">
            <Search className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${textSecondary}`} />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
              placeholder="Buscar por nombre o código..."
              className={`pl-8 pr-3 py-1.5 rounded-lg text-[12px] border w-full sm:w-72 ${
                isDark
                  ? "bg-[#1e293b] border-[#334155] text-white placeholder:text-white/30"
                  : "bg-white border-[#cbd5e1] text-[#0f172a] placeholder:text-[#94a3b8]"
              }`}
            />
          </div>
          <button
            onClick={fetchAirlines}
            className={`p-1.5 rounded-lg border transition-colors ${isDark ? "border-[#334155] text-[#94a3b8] hover:bg-[#1e293b]" : "border-[#cbd5e1] text-[#64748b] hover:bg-[#f1f5f9]"}`}
            title="Recargar"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={openCreate}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-white transition-colors shrink-0 ${isDark ? "bg-cyan-600 hover:bg-cyan-500" : "bg-blue-600 hover:bg-blue-700"}`}
          >
            <Plus className="w-3.5 h-3.5" /> Nueva Aerolínea
          </button>
        </div>
      </div>

      {/* Table */}
      <div className={`border rounded-xl overflow-hidden ${cardBg}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className={thBg}>
                <th className={`text-left px-3 py-2.5 ${textSecondary}`}>Código OACI</th>
                <th className={`text-left px-3 py-2.5 ${textSecondary}`}>Nombre</th>
                <th className={`text-left px-3 py-2.5 ${textSecondary}`}>Correo Electrónico</th>
                <th className={`text-center px-3 py-2.5 ${textSecondary}`}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className={`text-center py-12 ${textSecondary}`}>Cargando...</td>
                </tr>
              ) : pageData.length === 0 ? (
                <tr>
                  <td colSpan={4} className={`text-center py-12 ${textSecondary}`}>
                    {search ? "No se encontraron aerolíneas" : "No hay aerolíneas registradas"}
                  </td>
                </tr>
              ) : pageData.map(al => (
                <tr key={al.id} className={`border-t ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"} ${rowHover} transition-colors`}>
                  <td className="px-3 py-2.5">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-mono ${isDark ? "bg-cyan-500/10 text-cyan-400" : "bg-blue-600/10 text-blue-800"}`}>
                      {al.codigo}
                    </span>
                  </td>
                  <td className={`px-3 py-2.5 ${textPrimary}`}>{al.nombre}</td>
                  <td className={`px-3 py-2.5 ${textSecondary}`}>
                    <div className="flex items-center gap-1.5">
                      <Mail className="w-3 h-3" />
                      {al.correo || "—"}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => openEdit(al)} title="Editar"
                        className={`p-1.5 rounded-lg transition-colors ${isDark ? "hover:bg-[#334155] text-amber-400" : "hover:bg-[#e2e8f0] text-amber-600"}`}>
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setDeleteConfirm(al)} title="Eliminar"
                        className={`p-1.5 rounded-lg transition-colors ${isDark ? "hover:bg-[#334155] text-red-400" : "hover:bg-[#e2e8f0] text-red-600"}`}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length > ROWS_PER_PAGE && (
          <div className={`flex items-center justify-between px-3 py-2 border-t ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"}`}>
            <span className={`text-[11px] ${textSecondary}`}>
              {page * ROWS_PER_PAGE + 1}–{Math.min((page + 1) * ROWS_PER_PAGE, filtered.length)} de {filtered.length}
            </span>
            <div className="flex items-center gap-1">
              <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
                className={`p-1 rounded transition-colors disabled:opacity-30 ${isDark ? "hover:bg-[#334155] text-white" : "hover:bg-[#e2e8f0] text-[#0f172a]"}`}>
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className={`text-[11px] px-2 ${textSecondary}`}>{page + 1} / {totalPages}</span>
              <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}
                className={`p-1 rounded transition-colors disabled:opacity-30 ${isDark ? "hover:bg-[#334155] text-white" : "hover:bg-[#e2e8f0] text-[#0f172a]"}`}>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create / Edit Modal */}
      {modalMode && (
        <div className={`fixed inset-0 z-[60] flex items-center justify-center ${overlayBg}`} onClick={() => setModalMode(null)}>
          <div className={`border rounded-xl w-full max-w-lg mx-4 ${modalBg}`} onClick={e => e.stopPropagation()}>
            <div className={`flex items-center justify-between px-5 py-3.5 border-b ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"}`}>
              <h2 className={`text-[15px] ${textPrimary}`}>
                {modalMode === "create" ? "Registrar Aerolínea" : "Modificar Aerolínea"}
              </h2>
              <button onClick={() => setModalMode(null)} className={`p-1 rounded-lg transition-colors ${isDark ? "hover:bg-[#334155] text-white/60" : "hover:bg-[#e2e8f0] text-[#64748b]"}`}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Nombre de la aerolínea *</label>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="AeroLatam" className={inputCls} />
                  {errors.name && <p className={errorCls}>{errors.name}</p>}
                </div>
                <div>
                  <label className={labelCls}>Código OACI *</label>
                  <input
                    value={form.code}
                    onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                    placeholder="ALT"
                    maxLength={4}
                    disabled={modalMode === "edit"}
                    className={`${inputCls} ${modalMode === "edit" ? "opacity-50 cursor-not-allowed" : ""}`}
                  />
                  {errors.code && <p className={errorCls}>{errors.code}</p>}
                </div>
              </div>

              {modalMode === "create" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Correo electrónico *</label>
                    <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="contacto@aerolinea.com" className={inputCls} />
                    {errors.email && <p className={errorCls}>{errors.email}</p>}
                  </div>
                  <div>
                    <label className={labelCls}>Contraseña *</label>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={form.password}
                        onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                        placeholder="Contraseña"
                        className={inputCls}
                      />
                      <button type="button" onClick={() => setShowPassword(v => !v)} className={`absolute right-2.5 top-1/2 -translate-y-1/2 ${textSecondary}`}>
                        {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    {errors.password && <p className={errorCls}>{errors.password}</p>}
                  </div>
                </div>
              )}

              {modalMode === "create" && (
                <p className={`text-[11px] ${textSecondary}`}>
                  Se creará un usuario con rol <span className={isDark ? "text-cyan-400" : "text-blue-600"}>AEROLÍNEA</span> asociado a esta aerolínea.
                </p>
              )}
            </div>

            <div className={`flex items-center justify-end gap-2 px-5 py-3 border-t ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"}`}>
              <button onClick={() => setModalMode(null)}
                className={`px-4 py-1.5 rounded-lg text-[12px] border transition-colors ${isDark ? "border-[#334155] text-white/70 hover:bg-[#1e293b]" : "border-[#cbd5e1] text-[#64748b] hover:bg-[#f1f5f9]"}`}>
                Cancelar
              </button>
              <button onClick={handleSave} disabled={saving}
                className={`px-4 py-1.5 rounded-lg text-[12px] text-white transition-colors disabled:opacity-60 ${isDark ? "bg-cyan-600 hover:bg-cyan-500" : "bg-blue-600 hover:bg-blue-700"}`}>
                {saving ? "Guardando..." : modalMode === "create" ? "Registrar" : "Guardar Cambios"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteConfirm && (
        <div className={`fixed inset-0 z-[60] flex items-center justify-center ${overlayBg}`} onClick={() => setDeleteConfirm(null)}>
          <div className={`border rounded-xl w-full max-w-sm mx-4 ${modalBg}`} onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 text-center">
              <div className={`mx-auto w-10 h-10 rounded-full flex items-center justify-center mb-3 ${isDark ? "bg-red-500/15" : "bg-red-100"}`}>
                <AlertTriangle className={`w-5 h-5 ${isDark ? "text-red-400" : "text-red-600"}`} />
              </div>
              <h3 className={`text-[14px] mb-1 ${textPrimary}`}>Eliminar aerolínea</h3>
              <p className={`text-[12px] ${textSecondary}`}>
                ¿Estás seguro de eliminar <span className={textPrimary}>{deleteConfirm.nombre} ({deleteConfirm.codigo})</span>?
                <br />También se eliminarán los usuarios asociados.
              </p>
            </div>
            <div className={`flex items-center justify-center gap-2 px-5 py-3 border-t ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"}`}>
              <button onClick={() => setDeleteConfirm(null)}
                className={`px-4 py-1.5 rounded-lg text-[12px] border transition-colors ${isDark ? "border-[#334155] text-white/70 hover:bg-[#1e293b]" : "border-[#cbd5e1] text-[#64748b] hover:bg-[#f1f5f9]"}`}>
                Cancelar
              </button>
              <button onClick={confirmDelete}
                className="px-4 py-1.5 rounded-lg text-[12px] bg-red-600 hover:bg-red-500 text-white transition-colors">
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
