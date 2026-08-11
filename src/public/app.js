const projectSelect = document.getElementById("projectSelect");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const indexBtn = document.getElementById("indexBtn");
const layoutBtn = document.getElementById("layoutBtn");
const fitBtn = document.getElementById("fitBtn");
const clearBtn = document.getElementById("clearBtn");
const loadFullGraphBtn = document.getElementById("loadFullGraphBtn");
const insightsBtn = document.getElementById("insightsBtn");
const nodeLimitInput = document.getElementById("nodeLimitInput");
const edgeLimitInput = document.getElementById("edgeLimitInput");
const statusEl = document.getElementById("status");
const graphTitle = document.getElementById("graphTitle");
const graphStats = document.getElementById("graphStats");
const graphModeBadge = document.getElementById("graphModeBadge");
const detailsEl = document.getElementById("details");
const legendItems = document.getElementById("legendItems");
const categoryFiltersEl = document.getElementById("categoryFilters");
const layerFiltersEl = document.getElementById("layerFilters");
const featureFiltersEl = document.getElementById("featureFilters");
const structureSummaryEl = document.getElementById("structureSummary");
const graph2dEl = document.getElementById("graph2d");
const graph3dEl = document.getElementById("graph3d");
const view2dBtn = document.getElementById("view2dBtn");
const view3dBtn = document.getElementById("view3dBtn");
const categoryFilterSummaryEl = document.getElementById("categoryFilterSummary");
const threeDControlsEl = document.getElementById("threeDControls");
const zoomIn3dBtn = document.getElementById("zoomIn3dBtn");
const zoomOut3dBtn = document.getElementById("zoomOut3dBtn");
const reset3dBtn = document.getElementById("reset3dBtn");

const CATEGORY = {
  controller: { label: "Controller/API", color: "#60a5fa" },
  service: { label: "Service/Handler", color: "#a78bfa" },
  application: { label: "Application", color: "#c084fc" },
  domain: { label: "Domain/Entity", color: "#34d399" },
  interface: { label: "Interface", color: "#22d3ee" },
  repository: { label: "Repository", color: "#f59e0b" },
  database: { label: "Database/DbContext", color: "#fb923c" },
  infrastructure: { label: "Infrastructure", color: "#f97316" },
  contract: { label: "DTO/Contract", color: "#facc15" },
  enum: { label: "Enum", color: "#84cc16" },
  middleware: { label: "Middleware", color: "#38bdf8" },
  extension: { label: "Extension", color: "#94a3b8" },
  api: { label: "API", color: "#3b82f6" },
  component: { label: "Component", color: "#ec4899" },
  hook: { label: "Hook", color: "#14b8a6" },
  provider: { label: "Provider", color: "#8b5cf6" },
  context: { label: "Context", color: "#06b6d4" },
  type: { label: "Type", color: "#facc15" },
  symbol: { label: "Symbol", color: "#94a3b8" },
  unknown: { label: "Outro", color: "#64748b" }
};

const DOTNET_CATEGORIES = [
  "controller",
  "api",
  "service",
  "application",
  "domain",
  "interface",
  "repository",
  "database",
  "infrastructure",
  "contract",
  "enum",
  "middleware",
  "extension",
  "unknown"
];

const TYPESCRIPT_CATEGORIES = [
  "component",
  "hook",
  "provider",
  "context",
  "interface",
  "type",
  "service",
  "api",
  "symbol",
  "unknown"
];

const DEFAULT_CATEGORIES = Object.keys(CATEGORY);

const activeCategories = new Set(Object.keys(CATEGORY));
const activeLayers = new Set();
const activeFeatures = new Set();

let cy = null;
let selectedNodeId = null;
let isolatedNodeId = null;
let currentStructure = null;
let graph3d = null;
let viewMode = "2d";
let graphMode = "focused"; // 'focused' (pesquisa) | 'full' (projeto todo)
let last3DClick = {
  id: null,
  time: 0
};

// Performance Maps for 3D graph incremental updates
const graphNodesById = new Map();
const graphLinksById = new Map();
const projectsByName = new Map();

function initGraph() {
  cy = cytoscape({
    container: document.getElementById("cy"),
    elements: [],
    minZoom: 0.08,
    maxZoom: 3,
    style: [
      {
        selector: "node",
        style: {
          "background-color": "data(color)",
          "border-color": "#020617",
          "border-width": 2,
          "label": "data(label)",
          "color": "#e5e7eb",
          "font-size": 11,
          "text-outline-color": "#020617",
          "text-outline-width": 3,
          "text-valign": "bottom",
          "text-halign": "center",
          "width": "data(size)",
          "height": "data(size)"
        }
      },
      {
        selector: "node:selected",
        style: {
          "border-color": "#ffffff",
          "border-width": 4
        }
      },
      {
        selector: "node.expanded",
        style: {
          "border-color": "#22c55e",
          "border-width": 4
        }
      },
      {
        selector: "edge",
        style: {
          "width": 2,
          "line-color": "#93c5fd",
          "target-arrow-color": "#93c5fd",
          "target-arrow-shape": "triangle",
          "curve-style": "bezier",
          "label": "data(label)",
          "font-size": 9,
          "color": "#fca5a5",
          "text-background-color": "#020617",
          "text-background-opacity": 0.85,
          "text-background-padding": 2
        }
      },
      {
        selector: "edge[relation = 'uses']",
        style: {
          "line-color": "#f59e0b",
          "target-arrow-color": "#f59e0b"
        }
      },
      {
        selector: "edge[relation = 'references']",
        style: {
          "line-color": "#60a5fa",
          "target-arrow-color": "#60a5fa"
        }
      },
      {
        selector: ".faded",
        style: {
          "opacity": 0.15
        }
      },
      {
        selector: ".highlighted",
        style: {
          "opacity": 1
        }
      },
      {
        selector: ".category-hidden",
        style: {
          "display": "none"
        }
      },
      {
        selector: ".isolated-hidden",
        style: {
          "display": "none"
        }
      },
      {
        selector: ".structure-hidden",
        style: {
          "display": "none"
        }
      }
    ]
  });

  cy.on("tap", "node", (event) => {
    const node = event.target;
    selectNode(node.id());
  });

  cy.on("dbltap", "node", async (event) => {
    const node = event.target;
    await expandNode(node.id());
  });

  cy.on("tap", (event) => {
    if (event.target === cy) {
      clearSelection();
    }
  });
}
function initGraph3D() {
  graph3d = ForceGraph3D()(graph3dEl)
    .backgroundColor("#020617")
    .nodeLabel((node) => {
      return [
        node.label,
        node.categoryLabel,
        node.projectName,
        node.file
      ].filter(Boolean).join("\n");
    })
    .nodeColor((node) => {
      if (selectedNodeId && node.id === selectedNodeId) {
        return "#ffffff";
      }

      if (selectedNodeId && isNeighbour3D(node.id)) {
        return node.color || "#60a5fa";
      }

      if (selectedNodeId) {
        return "#334155";
      }

      return node.color || "#60a5fa";
    })
    .nodeVal((node) => {
      return Math.max(3, Number(node.size || 44) / 10);
    })
    .linkColor((link) => {
      if (link.relation === "uses") {
        return "#f59e0b";
      }

      if (link.relation === "references") {
        return "#60a5fa";
      }

      return "#93c5fd";
    })
    .linkOpacity(0.55)
    .linkWidth((link) => {
      if (!selectedNodeId) {
        return 1.2;
      }

      const sourceId = typeof link.source === "object" ? link.source.id : link.source;
      const targetId = typeof link.target === "object" ? link.target.id : link.target;

      return sourceId === selectedNodeId || targetId === selectedNodeId ? 3 : 0.6;
    })
    .linkDirectionalArrowLength(4)
    .linkDirectionalArrowRelPos(1)
    .linkCurvature(0.12)
    .cooldownTicks(120)
    .onNodeClick((node) => {
      const now = Date.now();

      selectNode(node.id);

      if (last3DClick.id === node.id && now - last3DClick.time < 420) {
        expandNode(node.id).catch((error) => {
          statusEl.textContent = error.message;
        });
      }

      last3DClick = {
        id: node.id,
        time: now
      };
    })
    .onBackgroundClick(() => {
      clearSelection();
    });

  // Configure OrbitControls for smooth 3D navigation
  // Left-click drag = rotate, Scroll = zoom, Right-click/Shift+drag = pan
  const controls = graph3d.controls();
  if (controls) {
    controls.enabled = true;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.enableRotate = true;
    controls.enableZoom = true;
    controls.screenSpacePanning = true;
    controls.rotateSpeed = 0.6;
    controls.zoomSpeed = 1.2;
    controls.panSpeed = 0.8;
    controls.minDistance = 50;
    controls.maxDistance = 5000;
    controls.autoRotate = false;
    controls.autoRotateSpeed = 0.3;

    if (controls.mouseButtons && window.THREE?.MOUSE) {
      controls.mouseButtons.LEFT = window.THREE.MOUSE.ROTATE;
      controls.mouseButtons.MIDDLE = window.THREE.MOUSE.DOLLY;
      controls.mouseButtons.RIGHT = window.THREE.MOUSE.PAN;
    }
  }

  // Handle container resize
  const resizeObserver = new ResizeObserver(() => {
    if (graph3d) {
      graph3d.width(graph3dEl.clientWidth);
      graph3d.height(graph3dEl.clientHeight);
    }
  });
  resizeObserver.observe(graph3dEl);
}
function sync3DFromCy() {
  if (!graph3d || !cy || viewMode !== "3d") {
    return;
  }

  const nodes = cy.nodes().filter((node) => {
    return isNodeVisible(node);
  }).map((node) => {
    return {
      ...node.data(),
      id: node.id()
    };
  });

  const visibleIds = new Set(nodes.map((node) => node.id));

  const links = cy.edges().filter((edge) => {
    return !edge.hasClass("isolated-hidden")
      && visibleIds.has(edge.data("source"))
      && visibleIds.has(edge.data("target"));
  }).map((edge) => {
    return {
      id: edge.id(),
      source: edge.data("source"),
      target: edge.data("target"),
      label: edge.data("label"),
      relation: edge.data("relation")
    };
  });

  graph3d.graphData({
    nodes,
    links
  });

  updateStats();
}

function addGraphData(result) {
  if (!graph3d || viewMode !== "3d") {
    return;
  }

  const newNodes = (result.nodes || []).filter((node) => {
    return !graphNodesById.has(node.id);
  });

  for (const node of newNodes) {
    const category = CATEGORY[node.category] || CATEGORY.unknown;
    graphNodesById.set(node.id, {
      ...node,
      color: category.color,
      categoryLabel: category.label,
      size: getNodeSize(node)
    });
  }

  const newLinks = (result.edges || []).filter((edge) => {
    return !graphLinksById.has(edge.id);
  });

  for (const edge of newLinks) {
    graphLinksById.set(edge.id, {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      label: edge.label,
      relation: edge.relation
    });
  }

  const visibleNodes = Array.from(graphNodesById.values()).filter((node) => {
    return isCategoryVisible(node.category)
      && isLayerVisible(node.layer)
      && isFeatureVisible(node.feature);
  });
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const visibleLinks = Array.from(graphLinksById.values()).filter((link) => {
    const edge = cy?.getElementById(link.id);
    return (!edge || !edge.length || !edge.hasClass("isolated-hidden"))
      && visibleIds.has(link.source)
      && visibleIds.has(link.target);
  });

  graph3d.graphData({
    nodes: visibleNodes,
    links: visibleLinks
  });

  updateStats();
}

function refresh3DStyle() {
  if (!graph3d) {
    return;
  }

  graph3d
    .nodeColor(graph3d.nodeColor())
    .linkWidth(graph3d.linkWidth());
}

function isNeighbour3D(nodeId) {
  if (!selectedNodeId || !cy) {
    return false;
  }

  const selected = cy.getElementById(selectedNodeId);

  if (!selected.length) {
    return false;
  }

  return selected.closedNeighborhood().nodes().some((node) => node.id() === nodeId);
}

function focus3DNode(nodeId) {
  if (!graph3d) {
    return;
  }

  const data = graph3d.graphData();
  const node = data.nodes.find((item) => item.id === nodeId);

  if (!node || node.x === undefined || node.y === undefined || node.z === undefined) {
    return;
  }

  const distance = 240;
  const length = Math.hypot(node.x, node.y, node.z) || 1;
  const ratio = 1 + distance / length;

  graph3d.cameraPosition(
    {
      x: node.x * ratio,
      y: node.y * ratio,
      z: node.z * ratio
    },
    node,
    650
  );
}

function get3DCameraTarget() {
  const controls = graph3d?.controls?.();
  const target = controls?.target;

  return {
    x: target?.x || 0,
    y: target?.y || 0,
    z: target?.z || 0
  };
}

function get3DCameraPosition() {
  const camera = graph3d?.cameraPosition?.() || {};

  return {
    x: Number(camera.x || 0),
    y: Number(camera.y || 0),
    z: Number(camera.z || 1200)
  };
}

function zoom3D(factor) {
  if (!graph3d || viewMode !== "3d") return;

  const target = get3DCameraTarget();
  const camera = get3DCameraPosition();
  const next = {
    x: target.x + (camera.x - target.x) * factor,
    y: target.y + (camera.y - target.y) * factor,
    z: target.z + (camera.z - target.z) * factor
  };

  graph3d.cameraPosition(next, target, 350);
  statusEl.textContent = factor < 1 ? "3D: zoom in." : "3D: zoom out.";
}

function reset3DView() {
  if (!graph3d || viewMode !== "3d") return;

  graph3d.zoomToFit(650, 90);
  statusEl.textContent = "3D: vista reajustada.";
}

function set3DAxisView(axisPlane) {
  if (!graph3d || viewMode !== "3d") return;

  const distance = get3DDistance();
  const positions = {
    xy: { x: 0, y: 0, z: distance },
    xz: { x: 0, y: -distance, z: 0 },
    yz: { x: distance, y: 0, z: 0 }
  };

  graph3d.cameraPosition(positions[axisPlane] || positions.xy, { x: 0, y: 0, z: 0 }, 650);
  statusEl.textContent = `3D: vista ${axisPlane.toUpperCase()} ativa.`;
}

function rotate3DAroundAxis(axis) {
  if (!graph3d || viewMode !== "3d") return;

  const target = get3DCameraTarget();
  const camera = get3DCameraPosition();
  const relative = {
    x: camera.x - target.x,
    y: camera.y - target.y,
    z: camera.z - target.z
  };
  const rotated = rotateVector(relative, axis, Math.PI / 8);

  graph3d.cameraPosition({
    x: target.x + rotated.x,
    y: target.y + rotated.y,
    z: target.z + rotated.z
  }, target, 420);
  statusEl.textContent = `3D: rotação no eixo ${axis.toUpperCase()}.`;
}

function get3DDistance() {
  const camera = get3DCameraPosition();
  const target = get3DCameraTarget();
  return Math.max(420, Math.hypot(camera.x - target.x, camera.y - target.y, camera.z - target.z) || 1200);
}

function rotateVector(vector, axis, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  if (axis === "x") {
    return {
      x: vector.x,
      y: vector.y * cos - vector.z * sin,
      z: vector.y * sin + vector.z * cos
    };
  }

  if (axis === "y") {
    return {
      x: vector.x * cos + vector.z * sin,
      y: vector.y,
      z: -vector.x * sin + vector.z * cos
    };
  }

  return {
    x: vector.x * cos - vector.y * sin,
    y: vector.x * sin + vector.y * cos,
    z: vector.z
  };
}

function setViewMode(mode) {
  viewMode = mode;

  if (mode === "3d") {
    graph2dEl.classList.add("hidden");
    graph3dEl.classList.remove("hidden");
    threeDControlsEl?.classList.remove("hidden");

    if (!graph3d) {
      initGraph3D();
    }

    view2dBtn.classList.remove("active-view");
    view3dBtn.classList.add("active-view");

    sync3DFromCy();

    setTimeout(() => {
      graph3d.width(graph3dEl.clientWidth);
      graph3d.height(graph3dEl.clientHeight);
      graph3d.zoomToFit(600, 80);
    }, 80);

    statusEl.textContent = "Modo 3D ativo. Clica num nó para detalhes; duplo clique para expandir.";
    return;
  }

  graph3dEl.classList.add("hidden");
  threeDControlsEl?.classList.add("hidden");
  graph2dEl.classList.remove("hidden");

  view3dBtn.classList.remove("active-view");
  view2dBtn.classList.add("active-view");

  statusEl.textContent = "Modo 2D ativo.";
}
async function loadProjects() {
  const data = await fetchJson("/api/projects");

  projectSelect.innerHTML = "";
  projectsByName.clear();

  for (const project of data.projects) {
    projectsByName.set(project.name, project);

    const option = document.createElement("option");
    option.value = project.name;
    option.textContent = formatProjectOption(project);
    option.title = project.exists
      ? project.absolutePath || project.relativePath || project.name
      : `Pasta não encontrada: ${project.absolutePath || project.relativePath || project.name}`;
    projectSelect.appendChild(option);
  }

  statusEl.textContent = data.projects.length
    ? "Projetos carregados."
    : "Ainda não tens projetos adicionados.";

  if (projectSelect.value) {
    await loadProjectStructure(projectSelect.value);
  }
}

function formatProjectOption(project) {
  const type = project.typeLabel || project.projectType || "Desconhecido";
  const details = [];

  if (project.csprojCount || project.slnCount) {
    details.push(`${project.csprojCount || 0} csproj`, `${project.slnCount || 0} sln`);
  }

  if (project.sourceFileCount) {
    details.push(`${project.sourceFileCount} source`);
  }

  if (!project.exists) {
    details.push("pasta em falta");
  }

  return `${project.name} (${[type, ...details].join(" · ")})`;
}

async function loadProjectStructure(projectName) {
  currentStructure = null;
  activeLayers.clear();
  activeFeatures.clear();

  if (structureSummaryEl) {
    structureSummaryEl.innerHTML = '<span class="spinner"></span>A carregar…';
  }
  if (layerFiltersEl) layerFiltersEl.innerHTML = "";
  if (featureFiltersEl) featureFiltersEl.innerHTML = "";

  if (!projectName) {
    return;
  }

  try {
    currentStructure = await fetchJson(`/api/projects/${encodeURIComponent(projectName)}/structure`);
    renderStructureFilters(currentStructure);
    renderCategoryFilters();
    applyCategoryFilters();
  } catch (error) {
    if (structureSummaryEl) {
      structureSummaryEl.textContent = "Indisponível";
    }
    statusEl.textContent = error.message;
  }
}

async function searchSymbols() {
  const project = projectSelect.value;
  const query = searchInput.value.trim();

  if (!project) {
    statusEl.textContent = "Seleciona um projeto.";
    return;
  }

  if (!query) {
    statusEl.textContent = "Escreve um símbolo para pesquisar.";
    return;
  }

  const url = `/api/explore/${encodeURIComponent(project)}/search?q=${encodeURIComponent(query)}`;
  statusEl.innerHTML = '<span class="spinner"></span>A pesquisar...';
  searchBtn.disabled = true;
  searchBtn.classList.add("loading");

  try {
    const result = await fetchJson(url);

    cy.elements().remove();
    graphMode = "focused";
    isolatedNodeId = null;
    addElements(result);
    runLayout();

    graphNodesById.clear();
    graphLinksById.clear();

    if (viewMode === "3d") {
      addGraphData(result);
    } else {
      sync3DFromCy();
    }

    graphTitle.textContent = `Pesquisa — ${query}`;
    statusEl.textContent = result.message || "Pesquisa carregada.";

    updateStats();

    if (result.nodes.length === 1) {
      selectNode(result.nodes[0].id);
    } else {
      detailsEl.innerHTML = `<div class="empty">Clica num nó para ver detalhes ou faz duplo clique para expandir.</div>`;
    }
  } catch (error) {
    statusEl.textContent = error.message;
  } finally {
    searchBtn.disabled = false;
    searchBtn.classList.remove("loading");
  }
}

async function expandNode(nodeId) {
  const project = projectSelect.value;

  if (!project || !nodeId) return;

  const node = cy.getElementById(nodeId);

  if (node.length && node.hasClass("expanded")) {
    statusEl.textContent = "Este nó já foi expandido.";
    return;
  }

  const url = `/api/explore/${encodeURIComponent(project)}/expand?nodeId=${encodeURIComponent(nodeId)}&direction=both`;
    const result = await fetchJson(url);

    addElements(result, nodeId);

    const expandedNode = cy.getElementById(nodeId);

    if (expandedNode.length) {
      expandedNode.addClass("expanded");

      cy.animate({
        center: {
          eles: expandedNode.closedNeighborhood()
        },
        duration: 250
      });
    }

    selectNode(nodeId);

    if (viewMode === "3d") {
      addGraphData(result);
      setTimeout(() => {
        focus3DNode(nodeId);
      }, 120);
    } else {
      sync3DFromCy();
    }

    statusEl.textContent = result.message || "Nó expandido.";
    updateStats();
  }

function addElements(result, centerNodeId = null) {
  const elements = [];

  const centerNode = centerNodeId ? cy.getElementById(centerNodeId) : null;
  const hasCenter = centerNode && centerNode.length > 0;
  const center = hasCenter ? centerNode.position() : { x: 0, y: 0 };

  const sideByNode = new Map();

  if (centerNodeId) {
    for (const edge of result.edges || []) {
      if (edge.from === centerNodeId) {
        sideByNode.set(edge.to, "right");
      }

      if (edge.to === centerNodeId) {
        sideByNode.set(edge.from, "left");
      }
    }
  }

  const newNodes = (result.nodes || []).filter((node) => {
    return !cy.getElementById(node.id).length;
  });

  const totals = {
    left: 0,
    right: 0,
    other: 0
  };

  for (const node of newNodes) {
    const side = sideByNode.get(node.id) || "other";
    totals[side] += 1;
  }

  const counters = {
    left: 0,
    right: 0,
    other: 0
  };

  for (const node of result.nodes || []) {
    if (cy.getElementById(node.id).length) continue;

    const category = CATEGORY[node.category] || CATEGORY.unknown;
    const element = {
      group: "nodes",
      data: {
        ...node,
        color: category.color,
        categoryLabel: category.label,
        size: getNodeSize(node)
      }
    };

    if (hasCenter) {
      const side = sideByNode.get(node.id) || "other";
      element.position = getIncrementalPosition(center, side, counters[side], totals[side]);
      counters[side] += 1;
    }

    elements.push(element);
  }

  for (const edge of result.edges || []) {
    if (cy.getElementById(edge.id).length) continue;

    elements.push({
      group: "edges",
      data: {
        id: edge.id,
        source: edge.from,
        target: edge.to,
        label: edge.label,
        relation: edge.relation
      }
    });
  }

  cy.add(elements);
  applyCategoryFilters();
}

function getIncrementalPosition(center, side, index, total) {
  const rowGap = 86;
  const columnGap = 340;

  const offsetY = (index - (total - 1) / 2) * rowGap;

  if (side === "left") {
    return {
      x: center.x - columnGap,
      y: center.y + offsetY
    };
  }

  if (side === "right") {
    return {
      x: center.x + columnGap,
      y: center.y + offsetY
    };
  }

  const angle = (Math.PI * 2 * index) / Math.max(total, 1);
  const radius = 240;

  return {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius
  };
}

function getNodeSize(node) {
  if (node.category === "controller") return 58;
  if (node.category === "service") return 54;
  if (node.category === "domain") return 52;
  if (node.category === "interface") return 46;
  return 44;
}

function runLayout() {
  const nodeCount = cy.nodes().length;
  const edgeCount = cy.edges().length;

  if (nodeCount === 0) {
    return;
  }

  if (edgeCount === 0) {
    cy.layout({
      name: "circle",
      animate: false,
      fit: true,
      padding: 80
    }).run();

    return;
  }

  if (nodeCount > 80) {
    cy.layout({
      name: "concentric",
      animate: false,
      fit: true,
      padding: 80,
      minNodeSpacing: 55
    }).run();

    return;
  }

  cy.layout({
    name: "cose",
    animate: false,
    fit: true,
    padding: 80,
    nodeRepulsion: 5000,
    idealEdgeLength: 130,
    edgeElasticity: 80,
    gravity: 0.18,
    numIter: 300,
    randomize: false
  }).run();
}

function selectNode(nodeId) {
  selectedNodeId = nodeId;

  const node = cy.getElementById(nodeId);
  if (!node.length) return;

  cy.elements().removeClass("faded highlighted");

  const neighbourhood = node.closedNeighborhood();
  cy.elements().not(neighbourhood).addClass("faded");
  neighbourhood.addClass("highlighted");

  cy.$(":selected").unselect();
  node.select();

  renderDetails(node);
  refresh3DStyle();

  if (viewMode === "3d") {
    focus3DNode(nodeId);
  }
}

function renderDetails(node) {
  const data = node.data();

  const incoming = node.incomers("edge").map((edge) => ({
    edge,
    node: edge.source()
  }));

  const outgoing = node.outgoers("edge").map((edge) => ({
    edge,
    node: edge.target()
  }));

  const category = CATEGORY[data.category] || CATEGORY.unknown;

  detailsEl.innerHTML = `
    <div class="detail-title">${escapeHtml(data.label)}</div>
    <span class="detail-badge" style="background:${category.color}">
      ${escapeHtml(category.label)}
    </span>

    <div class="detail-row">
      <span class="detail-label">Tipo</span>
      <span class="detail-value">${escapeHtml(data.kind || "-")}</span>
    </div>

    <div class="detail-row">
      <span class="detail-label">Projeto</span>
      <span class="detail-value">${escapeHtml(data.projectName || "-")}</span>
    </div>

    <div class="detail-row">
      <span class="detail-label">Camada</span>
      <span class="detail-value">${escapeHtml(data.layer || "-")}</span>
    </div>

    <div class="detail-row">
      <span class="detail-label">Feature</span>
      <span class="detail-value">${escapeHtml(data.feature || "-")}</span>
    </div>

    <div class="detail-row">
      <span class="detail-label">Namespace</span>
      <span class="detail-value">${escapeHtml(data.namespace || "-")}</span>
    </div>

    <div class="detail-row">
      <span class="detail-label">Ficheiro</span>
      <span class="detail-value">${escapeHtml(data.file || "-")}</span>
    </div>

    <div class="detail-actions">
      <button id="expandSelectedBtn">Expandir</button>
      <button id="impactSelectedBtn" class="secondary">Impacto</button>
      <button id="focusSelectedBtn" class="secondary">Focar</button>
      <button id="isolateSelectedBtn" class="secondary">Isolar vizinhança</button>
      <button id="restoreGraphBtn" class="secondary">Voltar ao completo</button>
      <button id="copyNameBtn" class="secondary">Copiar nome</button>
      <button id="copyPathBtn" class="secondary">Copiar path</button>
    </div>

    <div class="detail-section">
      <h3>Quem referencia (${incoming.length})</h3>
      ${renderRefList(incoming, "source")}
    </div>

    <div class="detail-section">
      <h3>Dependências usadas (${outgoing.length})</h3>
      ${renderRefList(outgoing, "target")}
    </div>
  `;

  document.getElementById("expandSelectedBtn").addEventListener("click", async () => {
    await expandNode(node.id());
  });

  document.getElementById("impactSelectedBtn").addEventListener("click", async () => {
    await loadImpact(node.id());
  });

  document.getElementById("focusSelectedBtn").addEventListener("click", () => {
    if (viewMode === "3d") {
      focus3DNode(node.id());
      return;
    }

    cy.animate({
      center: {
        eles: node
      },
      zoom: 1.15,
      duration: 350
    });
  });

  document.getElementById("isolateSelectedBtn").addEventListener("click", () => {
    isolateNeighborhood(node.id());
  });

  document.getElementById("restoreGraphBtn").addEventListener("click", () => {
    restoreFullGraphView();
  });

  document.getElementById("copyNameBtn").addEventListener("click", () => {
    copyText(data.label || data.name || node.id(), "Nome copiado.");
  });

  document.getElementById("copyPathBtn").addEventListener("click", () => {
    copyText(data.file || "", "Path copiado.");
  });

  detailsEl.querySelectorAll("[data-node-id]").forEach((el) => {
    el.addEventListener("click", () => {
      selectNode(el.dataset.nodeId);
    });
  });
}
function renderRefList(items) {
  if (!items.length) {
    return `<div class="empty">Sem dados visíveis. Expande mais nós.</div>`;
  }

  return items.map(({ edge, node }) => {
    const data = node.data();

    return `
      <div class="ref-item" data-node-id="${escapeAttribute(node.id())}">
        <div class="ref-title">${escapeHtml(data.label)}</div>
        <div class="ref-meta">${escapeHtml(edge.data("label") || "")}</div>
        <div class="ref-meta">${escapeHtml(data.file || "")}</div>
      </div>
    `;
  }).join("");
}

function clearSelection() {
  selectedNodeId = null;

  cy.elements().removeClass("faded highlighted");
  cy.$(":selected").unselect();

  detailsEl.innerHTML = `<div class="empty">Clica num nó para ver detalhes.</div>`;
  refresh3DStyle();
}

function isolateNeighborhood(nodeId) {
  const node = cy.getElementById(nodeId);

  if (!node.length) {
    return;
  }

  const visibleNodeIds = new Set(node.closedNeighborhood().nodes().map((item) => item.id()));

  cy.nodes().forEach((item) => {
    item.toggleClass("isolated-hidden", !visibleNodeIds.has(item.id()));
  });

  cy.edges().forEach((edge) => {
    const visible = visibleNodeIds.has(edge.source().id()) && visibleNodeIds.has(edge.target().id());
    edge.toggleClass("isolated-hidden", !visible);
  });

  isolatedNodeId = nodeId;
  selectNode(nodeId);
  sync3DFromCy();

  if (viewMode === "3d") {
    setTimeout(() => focus3DNode(nodeId), 120);
  } else {
    cy.animate({
      center: {
        eles: node.closedNeighborhood()
      },
      duration: 300
    });
  }

  statusEl.textContent = `Vizinhança de ${node.data("label") || nodeId} isolada.`;
  updateStats();
}

function restoreFullGraphView(options = {}) {
  isolatedNodeId = null;

  if (cy) {
    cy.elements().removeClass("isolated-hidden");
  }

  sync3DFromCy();

  if (viewMode === "3d" && graph3d) {
    graph3d.zoomToFit(500, 80);
  } else if (cy) {
    cy.fit(undefined, 60);
  }

  if (!options.silent) {
    statusEl.textContent = "Grafo completo reposto.";
  }

  updateStats();
}

async function copyText(value, successMessage) {
  if (!value) {
    statusEl.textContent = "Nada para copiar.";
    return;
  }

  try {
    await navigator.clipboard.writeText(value);
    statusEl.textContent = successMessage;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    statusEl.textContent = successMessage;
  }
}

async function runIndex() {
  const project = projectSelect.value;

  if (!project) {
    statusEl.textContent = "Seleciona um projeto.";
    return;
  }

  statusEl.innerHTML = '<span class="spinner"></span>A gerar index.scip...';
  indexBtn.disabled = true;
  indexBtn.classList.add("loading");

  try {
    const result = await fetchJson(`/api/index/${encodeURIComponent(project)}`, {
      method: "POST"
    });

    statusEl.textContent = [
      result.ok ? "Index criado com sucesso." : "Falhou a criação do index.",
      "",
      `Projeto: ${result.project}`,
      `Path: ${result.indexPath}`,
      "",
      result.stdout || "",
      result.stderr || ""
    ].join("\n");
  } finally {
    indexBtn.disabled = false;
    indexBtn.classList.remove("loading");
  }
}

async function loadFullGraph() {
  const project = projectSelect.value;

  if (!project) {
    statusEl.textContent = "Seleciona um projeto.";
    return;
  }

  const nodeLimit = parseInt(nodeLimitInput.value, 10) || 500;
  const edgeLimit = parseInt(edgeLimitInput.value, 10) || 1200;

  statusEl.innerHTML = '<span class="spinner"></span>A carregar projeto todo...';
  loadFullGraphBtn.disabled = true;
  loadFullGraphBtn.classList.add("loading");

  try {
    const query = buildFullGraphQuery({ nodeLimit, edgeLimit });
    const result = await fetchJson(`/api/explore/${encodeURIComponent(project)}/full?${query}`);

    cy.elements().remove();
    isolatedNodeId = null;

    graphNodesById.clear();
    graphLinksById.clear();

    addElements(result);

    runLayout();

    sync3DFromCy();

    graphTitle.textContent = "Projeto todo";

    graphMode = "full";

    statusEl.textContent = result.message || `Carregado: ${result.nodes?.length || 0} nós, ${result.edges?.length || 0} ligações`;
    updateStats();
  } catch (error) {
    statusEl.textContent = error.message;
  } finally {
    loadFullGraphBtn.disabled = false;
    loadFullGraphBtn.classList.remove("loading");
  }
}

async function loadImpact(nodeId) {
  const project = projectSelect.value;

  if (!project || !nodeId) return;

  statusEl.innerHTML = '<span class="spinner"></span>A calcular impacto...';

  try {
    const result = await fetchJson(`/api/explore/${encodeURIComponent(project)}/impact?nodeId=${encodeURIComponent(nodeId)}&depth=2&limit=80`);
    const affected = (result.affectedFiles || []).slice(0, 12)
      .map((file) => `<div class="ref-meta">${escapeHtml(file)}</div>`)
      .join("");

    detailsEl.insertAdjacentHTML("beforeend", `
      <div class="detail-section impact-section">
        <h3>Impacto (${escapeHtml(result.impact?.level || "-")})</h3>
        <div class="detail-row">
          <span class="detail-label">Dependentes diretos / transitivos</span>
          <span class="detail-value">${result.impact?.directDependentCount || 0} / ${result.impact?.transitiveDependentCount || 0}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Ficheiros afetados</span>
          <span class="detail-value">${result.impact?.affectedFileCount || 0}</span>
        </div>
        ${affected || `<div class="empty">Sem ficheiros afetados detetados.</div>`}
      </div>
    `);
    statusEl.textContent = result.message || "Impacto calculado.";
  } catch (error) {
    statusEl.textContent = error.message;
  }
}

async function loadInsights() {
  const project = projectSelect.value;

  if (!project) {
    statusEl.textContent = "Seleciona um projeto.";
    return;
  }

  statusEl.innerHTML = '<span class="spinner"></span>A calcular insights...';

  try {
    const result = await fetchJson(`/api/explore/${encodeURIComponent(project)}/insights?limit=12`);
    detailsEl.innerHTML = `
      <div class="detail-title">Insights arquiteturais</div>
      <div class="detail-row"><span class="detail-label">Grafo</span><span class="detail-value">${result.stats.nodeCount} nós · ${result.stats.edgeCount} ligações · ${result.stats.fileCount} ficheiros</span></div>
      <div class="detail-section">
        <h3>Símbolos centrais</h3>
        ${renderInsightNodes(result.highlyConnected || [])}
      </div>
      <div class="detail-section">
        <h3>Maiores módulos/features</h3>
        ${(result.largestModules || []).map((item) => `<div class="ref-item"><div class="ref-title">${escapeHtml(item.name)}</div><div class="ref-meta">${item.count} símbolos</div></div>`).join("")}
      </div>
      <div class="detail-section">
        <h3>Potenciais ciclos</h3>
        ${(result.potentialCycles || []).length ? result.potentialCycles.map((cycle) => `<div class="ref-item"><div class="ref-title">${cycle.nodes.map((node) => escapeHtml(node.label)).join(" ↔ ")}</div></div>`).join("") : `<div class="empty">Nenhum ciclo simples detetado.</div>`}
      </div>
    `;
    statusEl.textContent = result.message || "Insights carregados.";
  } catch (error) {
    statusEl.textContent = error.message;
  }
}

function renderInsightNodes(nodes) {
  if (!nodes.length) {
    return `<div class="empty">Sem dados suficientes.</div>`;
  }

  return nodes.map((node) => `
    <div class="ref-item" data-node-id="${escapeAttribute(node.id)}">
      <div class="ref-title">${escapeHtml(node.label)}</div>
      <div class="ref-meta">${escapeHtml(node.file || "")} · ${node.dependentCount || 0} dependentes · ${node.dependencyCount || 0} dependências</div>
    </div>
  `).join("");
}

function buildFullGraphQuery({ nodeLimit, edgeLimit }) {
  const params = new URLSearchParams({
    nodeLimit: String(nodeLimit),
    edgeLimit: String(edgeLimit)
  });

  if (currentStructure?.layers?.length && activeLayers.size < currentStructure.layers.length) {
    params.set("layers", activeLayers.size ? Array.from(activeLayers).join(",") : "__none__");
  }

  if (currentStructure?.features?.length && activeFeatures.size < currentStructure.features.length) {
    params.set("features", activeFeatures.size ? Array.from(activeFeatures).join(",") : "__none__");
  }

  return params.toString();
}

function isCategoryVisible(category) {
  return activeCategories.has(category || "unknown");
}

function isNodeVisible(node) {
  return isCategoryVisible(node.data("category"))
    && isLayerVisible(node.data("layer"))
    && isFeatureVisible(node.data("feature"))
    && !node.hasClass("isolated-hidden");
}

function isLayerVisible(layer) {
  const hasOptions = Boolean(currentStructure?.layers?.length);
  return !hasOptions || activeLayers.has(layer || "Other");
}

function isFeatureVisible(feature) {
  const hasOptions = Boolean(currentStructure?.features?.length);
  return !hasOptions || activeFeatures.has(feature || "Uncategorized");
}

function applyCategoryFilters() {
  if (!cy) {
    return;
  }

  cy.nodes().forEach((node) => {
    node.toggleClass("category-hidden", !isCategoryVisible(node.data("category")));
    node.toggleClass("structure-hidden", !isLayerVisible(node.data("layer")) || !isFeatureVisible(node.data("feature")));
  });

  if (viewMode === "3d") {
    sync3DFromCy();
  }

  updateStats();
}

function updateStats() {
  const visibleNodes = cy ? cy.nodes().filter((node) => isNodeVisible(node)) : [];
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id()));
  const visibleEdges = cy ? cy.edges().filter((edge) => {
    return !edge.hasClass("isolated-hidden")
      && visibleNodeIds.has(edge.data("source"))
      && visibleNodeIds.has(edge.data("target"));
  }) : [];
  const nodeCount = visibleNodes.length || 0;
  const edgeCount = visibleEdges.length || 0;
  const modeLabel = graphMode === "full" ? "Projeto todo" : "Focused";

  const isolationLabel = isolatedNodeId ? " · isolado" : "";
  graphStats.textContent = `${nodeCount} nós · ${edgeCount} ligações · ${viewMode.toUpperCase()}${isolationLabel}`;

  if (graphModeBadge) {
    graphModeBadge.textContent = modeLabel;
    graphModeBadge.dataset.mode = graphMode;
  }
}

function getVisibleCategoryKeys(projectType = getActiveProjectType()) {
  if (projectType === "dotnet") {
    return DOTNET_CATEGORIES;
  }

  if (projectType === "typescript") {
    return TYPESCRIPT_CATEGORIES;
  }

  return DEFAULT_CATEGORIES;
}

function getActiveProjectType() {
  if (currentStructure?.projectType) {
    return currentStructure.projectType;
  }

  const selectedProject = projectsByName.get(projectSelect.value);
  return selectedProject?.projectType || "unknown";
}

function getProjectTypeLabel(projectType = getActiveProjectType()) {
  if (projectType === "dotnet") return ".NET";
  if (projectType === "typescript") return "TypeScript";
  if (projectType === "nodejs") return "Node.js";
  return "Auto";
}

function renderLegend() {
  legendItems.innerHTML = getVisibleCategoryKeys()
    .map((key) => {
      const item = CATEGORY[key];
      return `
        <div class="legend-item">
          <span class="legend-color" style="background:${item.color}"></span>
          <span>${escapeHtml(item.label)}</span>
        </div>
      `;
    })
    .join("");
}

function renderStructureFilters(structure) {
  activeLayers.clear();
  activeFeatures.clear();

  const layers = structure.layers || [];
  const features = structure.features || [];

  for (const layer of layers) {
    activeLayers.add(layer.name);
  }

  for (const feature of features) {
    activeFeatures.add(feature.name);
  }

  if (structureSummaryEl) {
    structureSummaryEl.textContent = structure.canSubdivide
      ? `${layers.length} camadas · ${features.length} features`
      : "Sem subdivisão";
  }

  if (layerFiltersEl) {
    layerFiltersEl.innerHTML = layers.length
      ? layers.map((layer) => renderStructureCheckbox({
        value: layer.name,
        label: `${layer.name} (${layer.projectCount})`,
        meta: layer.projects.join(", "),
        kind: "layer"
      })).join("")
      : `<div class="empty compact-empty">Sem camadas detetadas.</div>`;
  }

  if (featureFiltersEl) {
    featureFiltersEl.innerHTML = features.length
      ? features.slice(0, 80).map((feature) => renderStructureCheckbox({
        value: feature.name,
        label: `${feature.name} (${feature.symbolCount})`,
        meta: feature.layers.join(", "),
        kind: "feature"
      })).join("")
      : `<div class="empty compact-empty">Sem features detetadas.</div>`;
  }

  bindStructureFilterEvents();
}

function renderStructureCheckbox({ value, label, meta, kind }) {
  return `
    <label class="category-filter structure-filter" title="${escapeAttribute(meta || "")}">
      <input type="checkbox" value="${escapeAttribute(value)}" data-kind="${escapeAttribute(kind)}" checked />
      <span>${escapeHtml(label)}</span>
    </label>
  `;
}

function bindStructureFilterEvents() {
  document.querySelectorAll("[data-kind='layer'], [data-kind='feature']").forEach((input) => {
    input.addEventListener("change", () => {
      const targetSet = input.dataset.kind === "layer" ? activeLayers : activeFeatures;

      if (input.checked) {
        targetSet.add(input.value);
      } else {
        targetSet.delete(input.value);
      }

      applyCategoryFilters();
    });
  });
}

function renderCategoryFilters() {
  if (!categoryFiltersEl) {
    return;
  }

  const projectType = getActiveProjectType();
  const categoryKeys = getVisibleCategoryKeys(projectType);

  activeCategories.clear();
  for (const key of categoryKeys) {
    activeCategories.add(key);
  }

  if (categoryFilterSummaryEl) {
    categoryFilterSummaryEl.textContent = getProjectTypeLabel(projectType);
  }

  categoryFiltersEl.innerHTML = categoryKeys
    .map((key) => {
      const item = CATEGORY[key];
      return `
        <label class="category-filter compact-filter">
          <input type="checkbox" value="${escapeAttribute(key)}" checked />
          <span class="legend-color" style="background:${item.color}"></span>
          <span>${escapeHtml(item.label)}</span>
        </label>
      `;
    })
    .join("");

  categoryFiltersEl.querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) {
        activeCategories.add(input.value);
      } else {
        activeCategories.delete(input.value);
      }

      applyCategoryFilters();
    });
  });

  renderLegend();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

searchBtn.addEventListener("click", () => {
  searchSymbols().catch((error) => {
    statusEl.textContent = error.message;
  });
});

searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    searchSymbols().catch((error) => {
      statusEl.textContent = error.message;
    });
  }
});

projectSelect.addEventListener("change", () => {
  loadProjectStructure(projectSelect.value).catch((error) => {
    statusEl.textContent = error.message;
  });
});

indexBtn.addEventListener("click", () => {
  runIndex().catch((error) => {
    statusEl.textContent = error.message;
  });
});

layoutBtn.addEventListener("click", () => {
  runLayout();
});

fitBtn.addEventListener("click", () => {
  if (viewMode === "3d") {
    graph3d.zoomToFit(600, 80);
    return;
  }

  cy.fit(undefined, 70);
});

clearBtn.addEventListener("click", () => {
    cy.elements().remove();

    if (graph3d) {
    graph3d.graphData({
        nodes: [],
        links: []
    });
    }

    graphNodesById.clear();
    graphLinksById.clear();

    clearSelection();
    updateStats();
    statusEl.textContent = "Grafo limpo.";
});

loadFullGraphBtn.addEventListener("click", () => {
  loadFullGraph().catch((error) => {
    statusEl.textContent = error.message;
  });
});

insightsBtn?.addEventListener("click", () => {
  loadInsights().catch((error) => {
    statusEl.textContent = error.message;
  });
});

view2dBtn.addEventListener("click", () => {
  setViewMode("2d");
});

view3dBtn.addEventListener("click", () => {
  setViewMode("3d");
});

zoomIn3dBtn?.addEventListener("click", () => {
  zoom3D(0.72);
});

zoomOut3dBtn?.addEventListener("click", () => {
  zoom3D(1.35);
});

reset3dBtn?.addEventListener("click", () => {
  reset3DView();
});

document.querySelectorAll("[data-3d-view]").forEach((button) => {
  button.addEventListener("click", () => {
    set3DAxisView(button.getAttribute("data-3d-view"));
  });
});

document.querySelectorAll("[data-3d-axis]").forEach((button) => {
  button.addEventListener("click", () => {
    rotate3DAroundAxis(button.getAttribute("data-3d-axis"));
  });
});

initGraph();
renderLegend();
renderCategoryFilters();
setViewMode("2d");

loadProjects().catch((error) => {
  statusEl.textContent = error.message;
});