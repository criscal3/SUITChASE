import React, { useState, useRef, useEffect } from "react";
import { useSim } from "../context/SimContext";
import { useTheme } from "../context/ThemeContext";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { ScrollArea } from "./ui/scroll-area";
import { Package, Plus, Search, Upload, FileText, ChevronDown, Plane, MapPin, Hash } from "lucide-react";
import { toast } from "sonner";
import { api } from "../services/api";

export function Registration({ showBatchImport = true }: { showBatchImport?: boolean }) {
  const { state, registerBaggage, batchImportBaggage } = useSim();
  const { isDark } = useTheme();
  
  const role = localStorage.getItem("suitchase_role");
  const assignedAirport = localStorage.getItem("suitchase_aeropuerto_oaci") || "";

  const [airportsList, setAirportsList] = useState<any[]>([]);
  const [airlines, setAirlines] = useState<any[]>([]);
  const [baggageGroups, setBaggageGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [origin, setOrigin] = useState(role === "OPERARIO" ? assignedAirport : "");
  const [destination, setDestination] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [airline, setAirline] = useState("");
  const [airlineSearch, setAirlineSearch] = useState("");
  const [airlineOpen, setAirlineOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  useEffect(() => {
    if (role === "OPERARIO" && assignedAirport) {
      setOrigin(assignedAirport);
    }
  }, [role, assignedAirport]);
  const fileRef = useRef<HTMLInputElement>(null);
  const airlineRef = useRef<HTMLDivElement>(null);

  // Close airline dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (airlineRef.current && !airlineRef.current.contains(e.target as Node)) {
        setAirlineOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filteredAirlines = airlines.filter(a =>
    (a.nombre || "").toLowerCase().includes(airlineSearch.toLowerCase()) ||
    (a.codigo || "").toLowerCase().includes(airlineSearch.toLowerCase())
  );

  // Theme classes
  const cardBg = isDark ? "bg-[#1e293b]/50 border-[#334155]" : "bg-white border-[#cbd5e1]";
  const titleColor = isDark ? "text-white" : "text-[#0f172a]";
  const inputBg = isDark ? "bg-[#0f172a] border-[#334155] text-white" : "bg-[#f8fafc] border-[#cbd5e1] text-[#0f172a]";
  const selectContentBg = isDark ? "bg-[#1e293b] border-[#334155]" : "bg-white border-[#cbd5e1]";
  const selectItemText = isDark ? "text-white" : "text-[#0f172a]";
  const subtleText = isDark ? "text-white/70" : "text-[#475569]";
  const subtlerText = isDark ? "text-white/60" : "text-[#64748b]";
  const cellText = isDark ? "text-white" : "text-[#0f172a]";
  const cellTextSub = isDark ? "text-white/80" : "text-[#475569]";
  const rowBorder = isDark ? "border-[#1e293b]" : "border-[#e2e8f0]";
  const rowHover = isDark ? "hover:bg-[#0f172a]/50" : "hover:bg-[#f1f5f9]";
  const cyanText = isDark ? "text-cyan-400" : "text-blue-700";
  const searchIconColor = isDark ? "text-white/40" : "text-[#94a3b8]";
  const headerBorder = isDark ? "border-[#334155]" : "border-[#e2e8f0]";
  const dropdownBg = isDark ? "bg-[#1e293b]" : "bg-white";
  const dropdownBorder = isDark ? "border-[#334155]" : "border-[#cbd5e1]";
  const dropdownHover = isDark ? "hover:bg-[#334155]" : "hover:bg-[#f1f5f9]";

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [aps, als, envs] = await Promise.all([
        api.getAirports(),
        api.getAirlines(),
        api.getOperacionesRT().catch(e => {
          console.warn("Could not fetch RT ops (backend might be restarting or 403):", e);
          return [];
        })
      ]);
      setAirportsList(aps.map((a: any) => ({ code: a.oaci, city: a.ciudad })));
      setAirlines(als);
      const envsMapped = envs.map((e: any) => ({
        id: e.id,
        origin: e.origenOaci,
        destination: e.destinoOaci,
        quantity: e.cantidadMaletas,
        airline: e.nombreAerolinea || als.find((a: any) => a.id === e.aerolineaId)?.nombre || e.aerolineaId,
        status: e.estado === 'PENDIENTE' ? 'waiting' :
                e.estado === 'PLANIFICADO' ? 'assigned' :
                e.estado === 'EN_RUTA' ? 'in_transit' :
                e.estado === 'ENTREGADO' ? 'delivered' :
                e.estado === 'COLAPSO' ? 'delayed' : 'failed',
        currentLocation: e.ubicacionActual || e.origenOaci,
        route: e.tramos ? e.tramos.map((t: any) => ({ from: t.origenOaci, to: t.destinoOaci })) : []
      }));
      setBaggageGroups(envsMapped);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!origin || !destination || !airline || origin === destination) {
      toast.error("Complete todos los campos. Origen y destino deben ser diferentes.");
      return;
    }
    const qty = parseInt(quantity);
    if (isNaN(qty) || qty < 1) {
      toast.error("Cantidad inválida.");
      return;
    }

    try {
      const al = airlines.find((a: any) => a.nombre === airline);
      await api.registrarPedidoRT({
        origenOaci: origin,
        destinoOaci: destination,
        cantidadMaletas: qty,
        aerolineaId: al?.id
      });
      toast.success(`${qty} maletas registradas: ${origin} → ${destination}`);
      setQuantity("1");
      fetchData(); // Refresh list
    } catch (err: any) {
      toast.error(err.message || "Error al registrar");
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".txt")) {
      toast.error("El archivo debe tener extensión .txt");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }

    const activeOrigin = role === "OPERARIO" ? assignedAirport : origin;
    if (!activeOrigin) {
      toast.error("No se ha detectado el aeropuerto de origen del operario.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const text = ev.target?.result as string;
        const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
        const items: { codigoAerolinea: string; destinoOaci: string; cantidadMaletas: number }[] = [];

        for (const line of lines) {
          const parts = line.split("-");
          if (parts.length !== 3) {
            toast.error(`Formato incorrecto en la línea: "${line}". Debe ser codigoAerolinea-destinoOaci-cantidadMaletas`);
            return;
          }

          const codAero = parts[0].trim().toUpperCase();
          const dest = parts[1].trim().toUpperCase();
          const qty = parseInt(parts[2].trim(), 10);

          if (!codAero || dest.length !== 4 || isNaN(qty) || qty < 1) {
            toast.error(`Datos inválidos en la línea: "${line}"`);
            return;
          }

          if (dest === activeOrigin) {
            toast.error(`El aeropuerto destino (${dest}) no puede ser igual al origen (${activeOrigin}).`);
            return;
          }

          items.push({
            codigoAerolinea: codAero,
            destinoOaci: dest,
            cantidadMaletas: qty
          });
        }

        if (items.length === 0) {
          toast.error("No se encontraron registros válidos en el archivo.");
          return;
        }

        setLoading(true);
        // Enviar lote al backend
        await api.registrarPedidoRTLote(items);
        toast.success(`${items.length} pedidos registrados en lote exitosamente.`);
        setQuantity("1");
        fetchData(); // Recargar tabla
      } catch (err: any) {
        toast.error(err.message || "Error al registrar el lote");
      } finally {
        setLoading(false);
      }
    };
    reader.readAsText(file);
    if (fileRef.current) fileRef.current.value = "";
  };

  const filtered = baggageGroups.filter(bg => {
    if (statusFilter !== "all" && bg.status !== statusFilter) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return bg.id.toLowerCase().includes(s) ||
      bg.origin.toLowerCase().includes(s) ||
      bg.destination.toLowerCase().includes(s) ||
      String(bg.airline).toLowerCase().includes(s);
  });

  const statusColors: Record<string, string> = {
    waiting: isDark ? "bg-amber-500/20 text-amber-400" : "bg-amber-100 text-amber-700 border border-amber-300",
    assigned: isDark ? "bg-cyan-500/20 text-cyan-400" : "bg-cyan-100 text-cyan-700 border border-cyan-300",
    in_transit: isDark ? "bg-blue-500/20 text-blue-400" : "bg-blue-100 text-blue-700 border border-blue-300",
    delivered: isDark ? "bg-green-500/20 text-green-400" : "bg-green-100 text-green-700 border border-green-300",
    delayed: isDark ? "bg-orange-500/20 text-orange-400" : "bg-orange-100 text-orange-700 border border-orange-300",
    failed: isDark ? "bg-red-500/20 text-red-400" : "bg-red-100 text-red-700 border border-red-300",
  };

  const statusLabels: Record<string, string> = {
    waiting: "En espera",
    assigned: "Asignado",
    in_transit: "En ruta",
    delivered: "Entregado",
    delayed: "Retrasado",
    failed: "Fallido",
  };

  return (
    <div className="space-y-4">
      {/* Formulario de registro */}
      <Card className={cardBg}>
        <CardHeader className="pb-2">
          <CardTitle className={`${titleColor} text-[14px] flex items-center gap-2`}>
            <Package className="w-4 h-4" /> Registrar Envío de Maletas
          </CardTitle>
          <p className={`text-[12px] ${subtlerText} mt-0.5`}>
            Complete los campos para registrar un nuevo lote de maletas al sistema.
          </p>
        </CardHeader>
        <CardContent className="pt-2">
          {/* Fields grid: 2 cols on md, full on sm */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">

            {/* Aerolínea */}
            <div ref={airlineRef} className="relative flex flex-col gap-1.5">
              <Label className={`text-[12px] font-medium ${subtleText} flex items-center gap-1.5`}>
                <Plane className="w-3.5 h-3.5" />
                Aerolínea
              </Label>
              {airlineOpen ? (
                <div className={`flex items-center h-9 w-full rounded-md border px-3 text-[13px] ${inputBg}`}>
                  <input
                    className="flex-1 bg-transparent outline-none text-[13px] min-w-0"
                    placeholder="Buscar aerolínea..."
                    value={airlineSearch}
                    onChange={e => setAirlineSearch(e.target.value)}
                    autoFocus
                  />
                  <ChevronDown className={`w-3.5 h-3.5 shrink-0 ${isDark ? "text-white/50" : "text-[#9ca3af]"}`} />
                </div>
              ) : (
                <div
                  className={`flex items-center h-9 w-full rounded-md border px-3 text-[13px] cursor-pointer ${inputBg}`}
                  onClick={() => { setAirlineOpen(true); setAirlineSearch(""); }}
                >
                  <span className={`flex-1 truncate ${!airline ? "text-muted-foreground" : ""}`}>
                    {airline || "Seleccionar aerolínea..."}
                  </span>
                  <ChevronDown className={`w-3.5 h-3.5 shrink-0 ${isDark ? "text-white/50" : "text-[#9ca3af]"}`} />
                </div>
              )}
              {airlineOpen && (
                <div className={`absolute z-50 top-full mt-1 w-full rounded-md border shadow-lg ${dropdownBg} ${dropdownBorder}`}>
                  <div className="max-h-48 overflow-y-auto">
                    {filteredAirlines.length === 0 ? (
                      <div className={`px-3 py-2 text-[12px] ${subtleText}`}>Sin resultados</div>
                    ) : (
                      filteredAirlines.map((a: any) => (
                        <div
                          key={a.id}
                          className={`px-3 py-1.5 text-[12px] cursor-pointer ${selectItemText} ${dropdownHover} ${airline === a.nombre ? (isDark ? "bg-blue-600/20" : "bg-blue-100") : ""}`}
                          onClick={() => { setAirline(a.nombre); setAirlineOpen(false); setAirlineSearch(""); }}
                        >
                          {a.nombre} <span className={subtlerText}>({a.codigo})</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Cantidad */}
            <div className="flex flex-col gap-1.5">
              <Label className={`text-[12px] font-medium ${subtleText} flex items-center gap-1.5`}>
                <Hash className="w-3.5 h-3.5" />
                Cantidad de maletas
              </Label>
              <Input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="Ej. 5"
                className={inputBg}
              />
            </div>

            {/* Origen */}
            <div className="flex flex-col gap-1.5">
              <Label className={`text-[12px] font-medium ${subtleText} flex items-center gap-1.5`}>
                <MapPin className="w-3.5 h-3.5" />
                Aeropuerto de origen
              </Label>
              <Select value={origin} onValueChange={setOrigin} disabled={role === "OPERARIO"}>
                <SelectTrigger className={inputBg}>
                  <SelectValue placeholder="Seleccionar origen..." />
                </SelectTrigger>
                <SelectContent className={selectContentBg}>
                  {airportsList.map(a => (
                    <SelectItem key={a.code} value={a.code} className={selectItemText}>{a.code} — {a.city}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Destino */}
            <div className="flex flex-col gap-1.5">
              <Label className={`text-[12px] font-medium ${subtleText} flex items-center gap-1.5`}>
                <MapPin className="w-3.5 h-3.5 text-blue-500" />
                Aeropuerto de destino
              </Label>
              <Select value={destination} onValueChange={setDestination}>
                <SelectTrigger className={inputBg}>
                  <SelectValue placeholder="Seleccionar destino..." />
                </SelectTrigger>
                <SelectContent className={selectContentBg}>
                  {airportsList.map(a => (
                    <SelectItem key={a.code} value={a.code} className={selectItemText}>{a.code} — {a.city}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Divider + Action */}
          <div className={`mt-4 pt-4 border-t flex items-center justify-between ${isDark ? "border-[#1e293b]" : "border-[#e2e8f0]"}`}>
            <p className={`text-[11px] ${subtlerText}`}>
              * Todos los campos son requeridos. Origen y destino deben ser distintos.
            </p>
            <Button
              onClick={handleRegister}
              className={`flex items-center gap-2 px-5 text-[13px] ${isDark ? "bg-blue-600 hover:bg-blue-500" : "bg-blue-600 hover:bg-blue-700"} text-white`}
            >
              <Plus className="w-4 h-4" />
              Registrar envío
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Importar archivo */}
      {showBatchImport && (
        <Card className={cardBg}>
          <CardHeader className="pb-3">
            <CardTitle className={`${titleColor} text-[14px] flex items-center gap-2`}>
              <Upload className="w-4 h-4" /> Importar Maletas en Lote (.txt)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept=".txt"
                onChange={handleFileUpload}
                className="hidden"
              />
              <Button onClick={() => fileRef.current?.click()} className={isDark ? "bg-cyan-400 text-black hover:bg-cyan-500" : "bg-blue-600 text-white hover:bg-blue-700"}>
                <FileText className="w-4 h-4 mr-2" /> Seleccionar Archivo (.txt)
              </Button>
              <div className={`text-[11px] ${subtlerText}`}>
                <p>Formato de línea: <code className={cyanText}>codigoAerolinea-destinoOaci-cantidadMaletas</code></p>
                <p>Ejemplo: <code className={cyanText}>LAN-SPIM-5</code></p>
                <p>El aeropuerto de origen será el asignado al operario ({assignedAirport || "No asignado"}).</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Lista de equipajes */}
      <Card className={cardBg}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className={`${titleColor} text-[14px]`}>
              Equipajes Registrados ({filtered.length})
            </CardTitle>
            <div className="flex items-center gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className={`h-8 w-36 text-[12px] ${inputBg}`}>
                  <SelectValue placeholder="Estado" />
                </SelectTrigger>
                <SelectContent className={selectContentBg}>
                  <SelectItem value="all" className={selectItemText}>Todos</SelectItem>
                  <SelectItem value="waiting" className={selectItemText}>En espera</SelectItem>
                  <SelectItem value="assigned" className={selectItemText}>Asignado</SelectItem>
                  <SelectItem value="in_transit" className={selectItemText}>En ruta</SelectItem>
                  <SelectItem value="delivered" className={selectItemText}>Entregado</SelectItem>
                  <SelectItem value="delayed" className={selectItemText}>Retrasado</SelectItem>
                  <SelectItem value="failed" className={selectItemText}>Fallido</SelectItem>
                </SelectContent>
              </Select>
              <div className="relative">
                <Search className={`w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 ${searchIconColor}`} />
                <Input
                  placeholder="Buscar..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className={`pl-7 h-8 w-48 text-[12px] ${inputBg}`}
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[500px]">
            <Table>
              <TableHeader>
                <TableRow className={headerBorder}>
                  <TableHead className={`${subtleText} text-[11px]`}>ID</TableHead>
                  <TableHead className={`${subtleText} text-[11px]`}>Aerolínea</TableHead>
                  <TableHead className={`${subtleText} text-[11px]`}>Origen</TableHead>
                  <TableHead className={`${subtleText} text-[11px]`}>Destino</TableHead>
                  <TableHead className={`${subtleText} text-[11px]`}>Cant.</TableHead>
                  <TableHead className={`${subtleText} text-[11px]`}>Ubicación</TableHead>
                  <TableHead className={`${subtleText} text-[11px]`}>Estado</TableHead>
                  <TableHead className={`${subtleText} text-[11px]`}>Ruta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.slice(-100).reverse().map(bg => (
                  <TableRow key={bg.id} className={`${rowBorder} ${rowHover}`}>
                    <TableCell className={`${cellText} text-[11px]`}>{bg.id}</TableCell>
                    <TableCell className={`${cellTextSub} text-[11px]`}>{bg.airline}</TableCell>
                    <TableCell className={`${cellTextSub} text-[11px]`}>{bg.origin}</TableCell>
                    <TableCell className={`${cellTextSub} text-[11px]`}>{bg.destination}</TableCell>
                    <TableCell className={`${cellText} text-[11px]`}>{bg.quantity}</TableCell>
                    <TableCell className={`${cyanText} text-[11px]`}>{bg.currentLocation}</TableCell>
                    <TableCell>
                      <Badge className={`text-[10px] ${statusColors[bg.status]}`}>
                        {statusLabels[bg.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className={`${subtlerText} text-[10px]`}>
                      {bg.route.length > 0
                        ? [bg.route[0].from, ...bg.route.map((l: any) => l.to)].join(" → ")
                        : "Sin ruta"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}