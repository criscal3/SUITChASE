import React, { useState, useEffect, useRef } from "react";
import { useTheme } from "../context/ThemeContext";
import {
  FolderUp, FolderCheck, Package, AlertTriangle, FileText,
  Clock, Globe, CheckCircle2, RefreshCw, Layers, Upload, Folder
} from "lucide-react";
import { toast } from "sonner";
import { api } from "../services/api";

export function EnviosSimuladosPanel() {
  const { isDark } = useTheme();
  const [loading, setLoading] = useState(true);
  const [carpetaInfo, setCarpetaInfo] = useState<{
    carpetaActual: string;
    cantidadArchivos: number;
    totalEnvios: number;
    simulacionesActivas: number;
    carpetasDisponibles?: string[];
  } | null>(null);

  const [pendingFolder, setPendingFolder] = useState<{
    nombre: string;
    files: File[];
  } | null>(null);

  const [confirmSelectFolder, setConfirmSelectFolder] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgressStatus, setUploadProgressStatus] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const cardBg = isDark ? "bg-[#0a0f1e]/80 border-[#1a2744]" : "bg-white border-[#cbd5e1]";
  const innerCardBg = isDark ? "bg-[#0f172a] border-[#1e293b]" : "bg-[#f8fafc] border-[#e2e8f0]";
  const textPrimary = isDark ? "text-[#e2e8f0]" : "text-[#0f172a]";
  const textSecondary = isDark ? "text-[#94a3b8]" : "text-[#64748b]";
  const modalBg = isDark ? "bg-[#0f172a] border-[#1e293b]" : "bg-white border-[#cbd5e1]";
  const overlayBg = "bg-black/60 backdrop-blur-sm";

  const fetchCarpetaInfo = async () => {
    setLoading(true);
    try {
      const data = await api.getCarpetaEnviosSimulados();
      setCarpetaInfo(data);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || "Error al obtener información de la carpeta actual");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCarpetaInfo();
  }, []);

  const triggerFileSelect = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const filesArray = Array.from(fileList);
    const validFiles = filesArray.filter(
      f => f.name.startsWith("_envios_") && f.name.endsWith(".txt")
    );

    if (validFiles.length === 0) {
      toast.error("No se encontraron archivos de envíos válidos (_envios_CODIGO.txt) en la carpeta seleccionada.");
      e.target.value = "";
      return;
    }

    const firstRelPath = validFiles[0].webkitRelativePath || "";
    const folderName = firstRelPath.includes("/")
      ? firstRelPath.split("/")[0]
      : "envios_simulados_cargados";

    setPendingFolder({
      nombre: folderName,
      files: validFiles
    });

    e.target.value = "";
  };

  const confirmUploadFolder = async () => {
    if (!pendingFolder) return;
    setUploading(true);
    setUploadProgressStatus("Iniciando preparación...");

    try {
      // 1. Iniciar sesión de carga y cancelar simulaciones
      const startRes = await api.iniciarCargaCarpetaEnvios(pendingFolder.nombre);
      const totalFiles = pendingFolder.files.length;

      // 2. Subir archivos uno a uno para evitar timeouts / payload limits
      for (let i = 0; i < totalFiles; i++) {
        const file = pendingFolder.files[i];
        const percent = Math.round(((i + 1) / totalFiles) * 100);
        setUploadProgressStatus(`Cargando archivo ${i + 1} de ${totalFiles} (${percent}%)...`);

        const formData = new FormData();
        formData.append("nombreCarpeta", pendingFolder.nombre);
        formData.append("archivo", file, file.name);

        await api.cargarArchivoEnviosIndividual(formData);
      }

      // 3. Finalizar y activar la carpeta
      setUploadProgressStatus("Finalizando y activando carpeta...");
      const res = await api.finalizarCargaCarpetaEnvios(pendingFolder.nombre);

      toast.success(
        startRes.simulacionesCanceladas > 0
          ? `Carpeta '${res.carpetaActual}' cargada. Se cancelaron ${startRes.simulacionesCanceladas} simulación(es) en curso.`
          : `Carpeta '${res.carpetaActual}' cargada exitosamente con ${res.cantidadArchivos} archivos.`
      );

      setPendingFolder(null);
      await fetchCarpetaInfo();
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || "Error al cargar los archivos de la carpeta");
    } finally {
      setUploading(false);
      setUploadProgressStatus("");
    }
  };

  const handleSelectExistingFolder = async (folderName: string) => {
    if (folderName === carpetaInfo?.carpetaActual) return;
    setConfirmSelectFolder(folderName);
  };

  const executeSelectExistingFolder = async () => {
    if (!confirmSelectFolder) return;
    setUploading(true);
    try {
      const res = await api.seleccionarCarpetaEnviosSimulados(confirmSelectFolder);
      toast.success(`Carpeta activa cambiada a '${res.carpetaActual}'`);
      setConfirmSelectFolder(null);
      await fetchCarpetaInfo();
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || "Error al cambiar de carpeta");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto overflow-y-auto h-full pb-16">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className={`text-xl font-bold flex items-center gap-2.5 ${textPrimary}`}>
            <Package className={`w-6 h-6 ${isDark ? "text-cyan-400" : "text-blue-600"}`} />
            Envíos Simulados
          </h1>
          <p className={`text-[13px] mt-1 ${textSecondary}`}>
            Gestión y carga de la carpeta de envíos síncronos y sintéticos para la simulación de 5 días.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchCarpetaInfo}
            disabled={loading}
            className={`p-2 rounded-lg border transition-colors ${
              isDark ? "border-[#1e293b] text-white/70 hover:bg-[#1e293b]" : "border-[#cbd5e1] text-[#64748b] hover:bg-[#f1f5f9]"
            }`}
            title="Recargar estado"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Input de tipo directorio (oculto) */}
      <input
        ref={fileInputRef}
        type="file"
        // @ts-ignore
        webkitdirectory="true"
        directory="true"
        multiple
        onChange={handleFolderSelect}
        className="hidden"
      />

      {/* Panel principal de estado de la carpeta actual */}
      <div className={`border rounded-2xl p-6 backdrop-blur-sm transition-all ${cardBg}`}>
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-4 flex-1">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className={`p-2.5 rounded-xl ${isDark ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" : "bg-blue-600/10 text-blue-700 border border-blue-600/20"}`}>
                  <FolderCheck className="w-6 h-6" />
                </div>
                <div>
                  <span className={`text-[11px] uppercase tracking-wider font-semibold ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
                    Carpeta de Envíos Simulados Activa
                  </span>
                  <h2 className={`text-lg font-mono font-bold ${textPrimary}`}>
                    {loading ? "Cargando..." : carpetaInfo?.carpetaActual || "_envios_preliminar_"}
                  </h2>
                </div>
              </div>

              {/* Selector de carpetas disponibles en el servidor */}
              {carpetaInfo?.carpetasDisponibles && carpetaInfo.carpetasDisponibles.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className={`text-[12px] whitespace-nowrap ${textSecondary}`}>Cambiar a disponible:</span>
                  <select
                    value={carpetaInfo.carpetaActual}
                    onChange={(e) => handleSelectExistingFolder(e.target.value)}
                    className={`px-3 py-1.5 rounded-xl text-[12px] border font-mono transition-colors ${
                      isDark ? "bg-[#0f172a] border-[#334155] text-cyan-400" : "bg-[#f8fafc] border-[#cbd5e1] text-blue-700"
                    }`}
                  >
                    {carpetaInfo.carpetasDisponibles.map(c => (
                      <option key={c} value={c}>
                        📁 {c}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Estadísticas de la carpeta actual */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className={`p-3.5 rounded-xl border ${innerCardBg}`}>
                <div className="flex items-center gap-2 mb-1">
                  <FileText className={`w-4 h-4 ${isDark ? "text-cyan-400" : "text-blue-600"}`} />
                  <span className={`text-[11px] ${textSecondary}`}>Archivos de Texto</span>
                </div>
                <div className={`text-base font-semibold font-mono ${textPrimary}`}>
                  {loading ? "..." : `${carpetaInfo?.cantidadArchivos ?? 0} archivos .txt`}
                </div>
              </div>

              <div className={`p-3.5 rounded-xl border ${innerCardBg}`}>
                <div className="flex items-center gap-2 mb-1">
                  <Package className={`w-4 h-4 ${isDark ? "text-green-400" : "text-green-600"}`} />
                  <span className={`text-[11px] ${textSecondary}`}>Total Envíos Registrados</span>
                </div>
                <div className={`text-base font-semibold font-mono ${textPrimary}`}>
                  {loading ? "..." : (carpetaInfo?.totalEnvios ?? 0).toLocaleString()}
                </div>
              </div>

              <div className={`p-3.5 rounded-xl border ${innerCardBg}`}>
                <div className="flex items-center gap-2 mb-1">
                  <Layers className={`w-4 h-4 ${isDark ? "text-amber-400" : "text-amber-600"}`} />
                  <span className={`text-[11px] ${textSecondary}`}>Simulaciones en Curso</span>
                </div>
                <div className={`text-base font-semibold ${carpetaInfo?.simulacionesActivas ? "text-amber-400 font-bold animate-pulse" : textPrimary}`}>
                  {loading ? "..." : (carpetaInfo?.simulacionesActivas ? `${carpetaInfo.simulacionesActivas} activa(s)` : "Ninguna")}
                </div>
              </div>
            </div>
          </div>

          {/* Botón Acción para Cargar Nueva Carpeta */}
          <div className="flex flex-col items-stretch sm:items-end justify-center gap-2 shrink-0">
            <button
              onClick={triggerFileSelect}
              className={`flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-[13px] font-semibold text-white transition-all shadow-md ${
                isDark ? "bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500" : "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500"
              }`}
            >
              <FolderUp className="w-4 h-4" />
              Cargar Nueva Carpeta de Envíos
            </button>
            <p className={`text-[11px] text-center sm:text-right ${textSecondary}`}>
              Selecciona una carpeta local con archivos <code className="text-cyan-400">_envios_*.txt</code>
            </p>
          </div>
        </div>
      </div>

      {/* Modal de Advertencia al Cambiar Carpeta Existente */}
      {confirmSelectFolder && (
        <div className={`fixed inset-0 z-[60] flex items-center justify-center ${overlayBg}`}>
          <div className={`border rounded-2xl w-full max-w-md mx-4 overflow-hidden shadow-2xl ${modalBg}`}>
            <div className={`flex items-center gap-3 px-6 py-4 border-b ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"}`}>
              <div className={`p-2 rounded-xl ${isDark ? "bg-amber-500/15 text-amber-400" : "bg-amber-100 text-amber-600"}`}>
                <Folder className="w-5 h-5" />
              </div>
              <div>
                <h3 className={`text-[15px] font-bold ${textPrimary}`}>Cambiar Carpeta Activa</h3>
                <p className={`text-[12px] ${textSecondary}`}>Destino: <span className="font-mono text-cyan-400">{confirmSelectFolder}</span></p>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div className={`p-3.5 rounded-xl border flex items-start gap-3 ${isDark ? "bg-amber-500/10 border-amber-500/20 text-amber-200" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                <div className="text-[12px] space-y-1">
                  <p className="font-semibold">¡Atención! Las simulaciones en curso se cancelarán.</p>
                  <p className="opacity-90">
                    Se cancelará cualquier simulación en ejecución o pausada al activar la carpeta <span className="font-mono underline font-semibold">{confirmSelectFolder}</span>.
                  </p>
                </div>
              </div>
            </div>

            <div className={`flex items-center justify-end gap-3 px-6 py-4 border-t ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"}`}>
              <button
                disabled={uploading}
                onClick={() => setConfirmSelectFolder(null)}
                className={`px-4 py-2 rounded-xl text-[12px] font-medium border transition-colors disabled:opacity-50 ${
                  isDark ? "border-[#334155] text-white/70 hover:bg-[#1e293b]" : "border-[#cbd5e1] text-[#64748b] hover:bg-[#f1f5f9]"
                }`}
              >
                Cancelar
              </button>
              <button
                disabled={uploading}
                onClick={executeSelectExistingFolder}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-[12px] font-semibold text-white bg-amber-600 hover:bg-amber-500 transition-colors disabled:opacity-50 shadow-md"
              >
                {uploading ? "Cambiando…" : "Confirmar Cambio"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Advertencia y Confirmación al Subir Nueva Carpeta */}
      {pendingFolder && (
        <div className={`fixed inset-0 z-[60] flex items-center justify-center ${overlayBg}`}>
          <div className={`border rounded-2xl w-full max-w-lg mx-4 overflow-hidden shadow-2xl ${modalBg}`}>
            {/* Header Modal */}
            <div className={`flex items-center gap-3 px-6 py-4 border-b ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"}`}>
              <div className={`p-2 rounded-xl ${isDark ? "bg-amber-500/15 text-amber-400" : "bg-amber-100 text-amber-600"}`}>
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className={`text-[15px] font-bold ${textPrimary}`}>Confirmar Carga de Nueva Carpeta</h3>
                <p className={`text-[12px] ${textSecondary}`}>Carpeta seleccionada: <span className="font-mono text-cyan-400">{pendingFolder.nombre}</span></p>
              </div>
            </div>

            {/* Contenido Modal */}
            <div className="p-6 space-y-4">
              <div className={`p-3.5 rounded-xl border flex items-start gap-3 ${isDark ? "bg-amber-500/10 border-amber-500/20 text-amber-200" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                <div className="text-[12px] space-y-1">
                  <p className="font-semibold">¡Atención! Las simulaciones en curso se cancelarán.</p>
                  <p className="opacity-90">
                    Al confirmar la carga de esta nueva carpeta de envíos simulados, el sistema <span className="underline font-semibold">cancelará automáticamente cualquier simulación de 5 días o tracking activo</span> y actualizará el archivo fuente del planificador.
                  </p>
                </div>
              </div>

              <div className={`p-4 rounded-xl border space-y-2 ${innerCardBg}`}>
                <div className={`text-[12px] font-medium ${textPrimary}`}>Resumen de la carpeta a importar:</div>
                <div className="flex items-center justify-between text-[12px]">
                  <span className={textSecondary}>Cantidad de archivos .txt:</span>
                  <span className={`font-mono font-semibold ${textPrimary}`}>{pendingFolder.files.length} archivos</span>
                </div>
                <div className="flex items-center justify-between text-[12px]">
                  <span className={textSecondary}>Nombre asignado:</span>
                  <span className={`font-mono font-semibold ${isDark ? "text-cyan-400" : "text-blue-600"}`}>{pendingFolder.nombre}</span>
                </div>
                {uploadProgressStatus && (
                  <div className="pt-2">
                    <div className="flex items-center justify-between text-[11px] font-mono text-cyan-400 mb-1">
                      <span>{uploadProgressStatus}</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
                      <div className="h-full bg-cyan-400 animate-pulse rounded-full w-full" />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Botones Modal */}
            <div className={`flex items-center justify-end gap-3 px-6 py-4 border-t ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"}`}>
              <button
                disabled={uploading}
                onClick={() => setPendingFolder(null)}
                className={`px-4 py-2 rounded-xl text-[12px] font-medium border transition-colors disabled:opacity-50 ${
                  isDark ? "border-[#334155] text-white/70 hover:bg-[#1e293b]" : "border-[#cbd5e1] text-[#64748b] hover:bg-[#f1f5f9]"
                }`}
              >
                Cancelar
              </button>
              <button
                disabled={uploading}
                onClick={confirmUploadFolder}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-[12px] font-semibold text-white bg-amber-600 hover:bg-amber-500 transition-colors disabled:opacity-50 shadow-md min-w-[180px] justify-center"
              >
                {uploading ? (
                  <>
                    <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full" />
                    Cargando archivos…
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    Confirmar y Cargar Carpeta
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sección Inferior de Especificaciones y Formatos de Importación (Basado en FlightsPanel) */}
      <div className={`border rounded-2xl backdrop-blur-sm ${cardBg}`}>
        <div className={`px-6 py-4 border-b flex items-center gap-3 ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"}`}>
          <FileText className={`w-5 h-5 ${isDark ? "text-cyan-400" : "text-blue-600"}`} />
          <div>
            <h3 className={`text-[14px] font-bold ${textPrimary}`}>Especificación y Formato de Envíos Simulados</h3>
            <p className={`text-[11px] ${textSecondary}`}>Requisitos para los archivos de texto y registros de envíos sintéticos</p>
          </div>
        </div>

        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Formato de Archivos */}
            <div className="space-y-3">
              <h4 className={`text-[13px] font-semibold flex items-center gap-2 ${textPrimary}`}>
                <FolderCheck className="w-4 h-4 text-cyan-400" />
                1. Nombres y Estructura de los Archivos
              </h4>
              <p className={`text-[12px] ${textSecondary}`}>
                Cada carpeta debe contener archivos de texto plano que representen los envíos cuyo origen sea el aeropuerto indicado en el nombre del archivo:
              </p>
              <div className={`rounded-xl p-3.5 font-mono text-[12px] space-y-1.5 border ${isDark ? "bg-[#1e293b]/70 border-[#334155] text-cyan-300" : "bg-[#f1f5f9] border-[#cbd5e1] text-blue-900"}`}>
                <div>_envios_<span className="text-amber-400">CODIGOAEROPUERTO</span>_.txt</div>
                <div className={`text-[11px] ${isDark ? "text-white/40" : "text-[#64748b]"}`}>
                  Ejemplos: <span className="text-cyan-400">_envios_SPIM_.txt</span>, <span className="text-cyan-400">_envios_SKBO_.txt</span>
                </div>
              </div>
            </div>

            {/* Formato de Registro por Línea */}
            <div className="space-y-3">
              <h4 className={`text-[13px] font-semibold flex items-center gap-2 ${textPrimary}`}>
                <FileText className="w-4 h-4 text-blue-400" />
                2. Formato de cada Línea de Envío
              </h4>
              <p className={`text-[12px] ${textSecondary}`}>
                Cada línea dentro del archivo de texto debe seguir el formato separado por guiones (<code className="text-cyan-400">-</code>):
              </p>
              <div className={`rounded-xl p-3.5 font-mono text-[12px] space-y-1.5 border ${isDark ? "bg-[#1e293b]/70 border-[#334155] text-cyan-300" : "bg-[#f1f5f9] border-[#cbd5e1] text-blue-900"}`}>
                <div>IdEnvio-FechaRegistro-Hora-Minuto-DestinoOACI-CantidadMaletas-IdCliente</div>
                <div className={`text-[11px] ${isDark ? "text-white/40" : "text-[#64748b]"}`}>
                  Ejemplo: <span className="text-green-400">000000001-20260102-00-53-LKPR-002-0012655</span>
                </div>
              </div>
            </div>
          </div>

          {/* Badges explicativos adicionales */}
          <div className={`pt-4 border-t grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"}`}>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
              <span className={`text-[11px] ${textSecondary}`}>
                <strong className={textPrimary}>Archivo por Origen:</strong> Un archivo `.txt` separado por cada aeropuerto de origen.
              </span>
            </div>

            <div className="flex items-start gap-2">
              <Globe className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <span className={`text-[11px] ${textSecondary}`}>
                <strong className={textPrimary}>Códigos OACI:</strong> Destino indicado mediante código de 4 letras (ej: LKPR, SKBO).
              </span>
            </div>

            <div className="flex items-start gap-2">
              <Clock className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
              <span className={`text-[11px] ${textSecondary}`}>
                <strong className={textPrimary}>Fecha y Hora:</strong> Fecha en formato `YYYYMMDD`, hora `HH` (00-23) y minuto `MM` (00-59).
              </span>
            </div>

            <div className="flex items-start gap-2">
              <Package className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span className={`text-[11px] ${textSecondary}`}>
                <strong className={textPrimary}>Maletas y Cliente:</strong> Cantidad formateada a 3 dígitos (ej: 002) e ID de cliente.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
