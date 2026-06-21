# Plan de construcción — Herramienta de diseño CCTV (Axionet)

> Producto: herramienta web para que instaladores/integradores diseñen sistemas de
> CCTV sobre un plano, calculen cobertura (FOV/DORI/PPM), generen BOM + cotización
> y exporten una propuesta profesional. Competidor de referencia: cctvdesigntool.com.
> Nombre tentativo: por definir (ej. "AxioCCTV", "VigilaPlan").

---

## 1. Diferenciadores (por qué el nuestro gana)

1. **IA de diseño automático (Claude)** — el gran diferenciador:
   - "Dibuja el perímetro / zona a cubrir → la IA propone cámaras (modelo, altura,
     ángulo) para cubrirla cumpliendo el nivel DORI deseado."
   - "Sube una foto/plano del sitio → diseño base autogenerado."
   - El competidor es 100% manual.
2. **LatAm/Chile primero**: precios en **CLP/UF**, catálogos de proveedores locales,
   español nativo, normativa local. Ellos son muy EU/UK.
3. **Puente diseño → venta → CRM**: la cotización se conecta a **AXIOProject**
   (oportunidad/cliente). Nadie en el nicho lo tiene.
4. **Vista 3D opcional** (aprovecha la experiencia de DCIM 3D).
5. **Mapas más baratos** (OpenStreetMap / Esri free) para bajar costos vs sus 3
   proveedores pagos (Google/ArcGIS/Mapbox).
6. **Base de cámaras propia** con pipeline de ingesta por IA (ver §4).

---

## 2. Modelo de datos de un proyecto (derivado del análisis del competidor)

Un proyecto es un JSON con:
- `background` (imagen del plano o satélite) + `scale` / `pxPerMeter` (calibración)
- `realPosition` (geo lat/lng, para proyectos satelitales)
- `floors[]` (multi-piso) → cada piso con sus capas
- `cameras[]` (ver §3)
- `devices[]` (NVR, switches PoE, etc.) + `deviceAssemblies[]` (grupos reutilizables)
- `walls[]` (muros/obstáculos dibujados)
- `connections[]` (cableado/red, con waypoints y tipo de cable)
- `images[]` / `otherObjects[]` (anotaciones, logos)
- `pricingData` (BOM, márgenes, impuestos)
- `networkData` (diagrama de red, IPs)
- `reportData` / `simpleReportData` / `titleBlockData` (config de informes y rótulo)
- `options` (preferencias del proyecto) · `name` · `id` · `ver`

> Nota: el competidor guarda esto cifrado en modo "zeroKnowledge". Para el MVP
> guardamos en Postgres (Neon) por usuario; cifrado E2E como mejora futura.

---

## 3. Base de datos de cámaras PROPIA (legal y mejor)

NO copiamos la de nadie. La construimos desde datasheets públicos de fabricantes.

### Esquema de una cámara
```
camara {
  id, marca, modelo, tipo,            // tipo: dome|bullet|fisheye|ptz|box|turret
  sensor_pulgadas,                    // ej "1/2.8"
  sensor_ancho_mm,                    // derivado del formato (tabla estándar)
  resolucion_w, resolucion_h,         // px (ej 2592x1944 = 5MP)
  lente_tipo,                         // fija | varifocal | motorizada | PTZ
  focal_min_mm, focal_max_mm,         // rango de lente
  hfov_min_deg, hfov_max_deg,         // opcional: se puede calcular del sensor+focal
  ir_alcance_m,                       // alcance visión nocturna
  ip_rating, poe, wdr, codec,         // metadatos
  precio_clp, proveedor,              // pricing local
  imagen_url, datasheet_url
}
```

### Cómo se calcula la cobertura (es matemática, no un dataset)
```
HFOV = 2 · atan( sensor_ancho_mm / (2 · focal_mm) )
W(d) = 2 · d · tan(HFOV/2)                 // ancho cubierto a distancia d
PPM(d) = resolucion_w / W(d)               // píxeles por metro
distancia_DORI(umbral) = resolucion_w / (2 · umbral · tan(HFOV/2))
   umbrales EN 62676-4: Detect 25 · Observe 62 · Recognise 125 · Identify 250
```
Con esto se dibuja el cono FOV y los anillos DORI sobre el plano, idéntico al
competidor, con data propia.

### Poblar / agregar marcas (pipeline con IA)
- Soltar los **datasheets PDF** del fabricante → Claude (visión/texto) los parsea
  al esquema de arriba → revisión humana → insert en la BD.
- Semilla inicial: top fabricantes (Hikvision, Dahua, Axis, Bosch, Hanwha, Uniview)
  con sus modelos más vendidos en Chile. Crecer por demanda.
- Tabla estándar de `sensor_ancho_mm` por formato (1/3", 1/2.8", 1/1.8", etc.).

---

## 4. Arquitectura técnica (stack)

- **Frontend**: React + **canvas** para el editor de planos (Konva.js o Fabric.js;
  alternativa SVG). Zoom/pan, capas, snap, dibujo de muros, colocación de cámaras
  con cono FOV/DORI en vivo.
- **Cálculo FOV/DORI/PPM**: módulo JS puro (fórmulas §3), en el cliente.
- **Backend**: Node/Express (como tus otras apps) + **Postgres (Neon)**.
- **BD de cámaras**: tabla `camaras` (propia) + endpoint de búsqueda/filtro.
- **IA**: Claude para (a) auto-diseño de cobertura y (b) ingesta de datasheets.
- **Mapas**: OpenStreetMap/Esri (gratis) para satélite; calibración por escala.
- **Export**: PDF de propuesta (con plano, BOM, precios, rótulo) — librería tipo
  pdfmake/puppeteer; ZIP opcional.
- **Auth/multiusuario**: como Reembolsos (JWT, invitación, roles).
- **Deploy**: Render/Vercel + Neon (mismo patrón que ya usas).

---

## 5. Módulos del MVP (por fases)

- **Fase 0** — Andamiaje: auth multiusuario, crear/abrir proyecto, lienzo base.
- **Fase 1** — Editor de plano: importar imagen/PDF, calibrar escala, dibujar muros,
  capas, multi-piso, zoom/pan, deshacer/rehacer.
- **Fase 2** — Cámaras + cobertura: BD de cámaras (semilla), colocar cámara, cono
  FOV + zonas DORI + PPM en vivo, altura/ángulo/lente editables.
- **Fase 3** — Dispositivos + cableado + red: NVR/switches, conexiones con cálculo
  de longitud, diagrama de red, IPs.
- **Fase 4** — BOM + precios + propuesta PDF (con márgenes, impuestos, rótulo).
- **Fase 5** — **IA de auto-diseño** (el diferenciador): cubrir un área dada.
- **Fase 6** — Integración CRM (AXIOProject), 3D opcional, satélite.
- **Pipeline paralelo** — Ingesta de datasheets con IA para crecer la BD de cámaras.

---

## 6. Pendientes por definir
- Nombre y subdominio del producto.
- Alcance del MVP (¿partimos por interiores con plano subido, o satélite?).
- Lista inicial de fabricantes/modelos para la semilla de la BD (mercado chileno).
- Modelo de negocio (¿freemium como ellos? ¿precio CLP?).
