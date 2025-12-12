
// =======================
// Konfiguration
// =======================
const CONFIG = {
  pricePerPoint: 50,
  regionPercentage: 10,
  updateInterval: 30, // sekunder
  minDistance: 0.5,     // minsta pixelavstånd mellan punkter
  newDonationDuration: 20, // sekunder
  apiUrl: "https://actsvenskakyrkan.adoveo.com/getProgressbarData/40",
  useMockData: true,
  maxPointsPerBatch: 2000, // Ökad för snabbare initial laddning - canvas kan hantera många prickar effektivt
  maxPointsForBlink: 18000, // Max antal prickar för att aktivera blink-animation (över detta används fast opacity)
  circleBoundary: {
    enabled: false,
    centerX: 0.45,     // 0-1, relativt till kartans höjd (0.5 = mitt)
    centerY: 0.67,     // 0-1, relativt till kartans bredd (0.5 = mitt)
    radius: 0.40,       // 0-1, relativt till kartans minsta dimension
    showVisual: true   // visa cirkeln på canvas
  },
  // Kartfärger
  mapColors: {
    fill: "#928884",   // Landfärg
    stroke: "#beb8b8", // Kantfärg
    strokeWidth: "0.5" // Kantbredd
  },
  // Prick-konfiguration
  pointColors: {
    // Vanliga prickar
    regular: {
      main: "rgba(255, 223, 128, {opacity})",      // Huvudfärg (gul)
      shadow: "rgba(255, 223, 128, {opacity})"     // Skugga
    },
    // Nya prickar (med extra glöd)
    new: {
      main: "rgba(255, 60, 38, {opacity})",        // Huvudfärg (röd/orange)
      outerGlow: "rgba(255, 100, 50, {opacity})",  // Yttre glöd
      innerGlow: "rgba(255, 150, 80, {opacity})",  // Inner glöd
      shadow: "rgba(255, 100, 50, {opacity})"      // Skugga
    }
  },
  pointSizes: {
    regular: 1,    // Basradie för vanliga prickar (multipliceras med jitter)
    new: 6         // Basradie för nya prickar (multipliceras med jitter)
  },
  // Bild-konfiguration
  imageBlinkEnabled: true, // Aktivera blink-animation för bilder
  imageUrls: {
    regular: "https://freesvg.org/img/Natanteam-Heart.png", // Bild för vanliga prickar
    new: "https://freesvg.org/img/Natanteam-Heart.png"      // Bild för nya prickar (kan vara samma eller annan)
  },
  imageSizes: {
    regular: 8,    // Storlek för vanliga prickar (pixlar)
    new: 24        // Storlek för nya prickar (pixlar)
  }
};

// =======================
// Regioner 
// =======================
const REGION_COUNTRIES = {
  // South America
  BR: "Brazil", AR: "Argentina", PE: "Peru", CO: "Colombia",
  VE: "Venezuela", CL: "Chile", EC: "Ecuador", BO: "Bolivia",
  PY: "Paraguay", UY: "Uruguay", GY: "Guyana", SR: "Suriname",
  GF: "French Guiana", FK: "Falkland Islands",
  // Southern Africa
  ZA: "South Africa", ZW: "Zimbabwe", BW: "Botswana", NA: "Namibia",
  MZ: "Mozambique", ZM: "Zambia", MW: "Malawi", MG: "Madagascar",
  LS: "Lesotho", SZ: "Eswatini", CD: "Democratic Republic of Congo", AO: "Angola", 
  TZ: "Tanzania"
};

// Lägg till efter REGION_COUNTRIES
const LOW_PRIORITY_COUNTRIES = {
  // Lägg till ISO-landskoder för länder som ska prioriteras lägre
   //ISR: "Israel", 
   SJ: "Svalbard and Jan Mayen"
};

// Länder som ska exkluderas helt (får inga prickar)
const EXCLUDED_COUNTRIES = {
 
};

// =======================
// Globalt state
// =======================
let currentAmount = 0;
let previousAmount = 0;
let points = [];
let mapSvg = null;
let mapContainer = null;
let canvas = null;
let ctx = null;
let updateTimer = null;

let pendingRegularPoints = 0;      
let pendingNewPoints = 0;         
let placementLoopRunning = false;
let isFirstLoad = true;

// Bild-objekt för prickar
let regularImage = null;
let newImage = null;
let imagesLoaded = false; 



// =======================
// Mock & API helpers
// =======================
let MOCK_MODE = CONFIG.useMockData;
const MOCK_RESPONSE = { amount: 49000 };
const API_URL = CONFIG.apiUrl;

function getMockDonationData() {
  // Om det är första gången (currentAmount är 0), sätt bassumma
  if (currentAmount === 0) {
    return { amount: MOCK_RESPONSE.amount };
  }
  
  // Annars lägg till 1-3 prickar
  const pointsToAdd = 1 + Math.floor(Math.random() * 3);
  const amountToAdd = pointsToAdd * CONFIG.pricePerPoint;
  return { amount: currentAmount + amountToAdd };
}

function fetchData(url) {
  if (MOCK_MODE) {
    // Använd getMockDonationData() för att simulera ökande belopp
    const mockData = getMockDonationData();
    console.log("[MOCK]", mockData);
    return Promise.resolve({ amount: Number(mockData.amount) || 0 });
  }

  return fetch(url, { cache: "no-store" })
    .then(res =>
      res.json().catch(() =>
        res.text().then(t => JSON.parse(t))
      )
    )
    .then(data => ({ amount: Number(data?.amount) || 0 }))
    .catch(e => {
      console.error("[API error]", e);
      return { amount: 0 };
    });
}

// =======================
// Init
// =======================
document.addEventListener("DOMContentLoaded", () => {
  initializeElements();
  loadMap();
  loadImages(); // Ladda bilder om de ska användas
  fetchDonationData();
  startAutoUpdate();

  // Konsol-hjälpare
  Object.assign(window, {
    fetchDonationData,
    addTestDonation,
    testNewPoints, // Ny funktion
    setMockMode: (on) => { MOCK_MODE = !!on; console.log("MOCK_MODE:", MOCK_MODE); },
    setAmount: (n) => {
      previousAmount = currentAmount;
      currentAmount = Number(n) || 0;
      updatePoints();
      console.log("Current amount set to", currentAmount);
    },
    drawCircleBoundary
  });
});

function initializeElements() {
  mapContainer = document.getElementById("mapContainer");
  canvas = document.getElementById("pointCanvas");

  if (!canvas && mapContainer?.parentElement) {
    canvas = createCanvasElement();
    mapContainer.parentElement.appendChild(canvas);
  }

  if (canvas) {
    ctx = canvas.getContext("2d");
    resizeCanvas();
    
    // Debounced resize handler
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(resizeCanvas, RESIZE_DEBOUNCE_MS);
    });

    if (CONFIG.circleBoundary.enabled && CONFIG.circleBoundary.showVisual) {
      canvas.style.opacity = "1";
    }
  } else {
    console.warn("Canvas element could not be created. Some features may not work.");
    canvas = document.createElement("canvas");
    ctx = canvas.getContext("2d");
  }
  
  // Uppdatera ljus-räknaren initialt
  updateLightsCounter();
}

// Ladda bilder för prickar
function loadImages() {
  
  let loadedCount = 0;
  const totalImages = 2; // regular och new
  
  function checkAllLoaded() {
    loadedCount++;
    if (loadedCount === totalImages) {
      imagesLoaded = true;
      console.log("[IMAGES] Alla bilder laddade");
      // Rita om prickar när bilderna är laddade
      if (points.length > 0) {
        scheduleRedraw();
      }
    }
  }
  
  // Ladda vanliga prick-bild
  regularImage = new Image();
  regularImage.crossOrigin = "anonymous"; // För CORS
  regularImage.onload = checkAllLoaded;
  regularImage.onerror = () => {
    console.warn("[IMAGES] Kunde inte ladda regular image:", CONFIG.imageUrls.regular);
    checkAllLoaded(); // Fortsätt ändå
  };
  regularImage.src = CONFIG.imageUrls.regular;
  
  // Ladda nya prick-bild
  newImage = new Image();
  newImage.crossOrigin = "anonymous"; // För CORS
  newImage.onload = checkAllLoaded;
  newImage.onerror = () => {
    console.warn("[IMAGES] Kunde inte ladda new image:", CONFIG.imageUrls.new);
    checkAllLoaded(); // Fortsätt ändå
  };
  newImage.src = CONFIG.imageUrls.new;
}

function createCanvasElement() {
  const canvasEl = document.createElement("canvas");
  canvasEl.id = "pointCanvas";
  Object.assign(canvasEl.style, {
    position: "absolute",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    zIndex: "5",
    opacity: "1"
  });
  return canvasEl;
}

// Debounce för resize
let resizeTimeout = null;
const RESIZE_DEBOUNCE_MS = 150;

function resizeCanvas() {
  if (canvas && mapContainer && mapSvg) {
    // Hämta SVG:s faktiska renderade storlek (efter object-fit: contain)
    const svgRect = mapSvg.getBoundingClientRect();
    
    // Canvas är i .map-inner, så vi behöver positionera relativt till den
    const mapInner = mapContainer.parentElement; // .map-inner
    const mapInnerRect = mapInner ? mapInner.getBoundingClientRect() : null;
    
    // Använd SVG:s faktiska renderade storlek för canvas
    const canvasWidth = svgRect.width;
    const canvasHeight = svgRect.height;
    
    // Sätt canvas-storlek i pixlar (device pixel ratio för skarpa prickar)
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    
    // Sätt CSS-storlek till faktisk storlek (utan DPR)
    canvas.style.width = canvasWidth + 'px';
    canvas.style.height = canvasHeight + 'px';
    
    // Positionera canvas exakt över SVG (relativt till .map-inner)
    if (mapInnerRect) {
      canvas.style.left = (svgRect.left - mapInnerRect.left) + 'px';
      canvas.style.top = (svgRect.top - mapInnerRect.top) + 'px';
    } else {
      // Fallback: relativt till container
      const containerRect = mapContainer.getBoundingClientRect();
      canvas.style.left = (svgRect.left - containerRect.left) + 'px';
      canvas.style.top = (svgRect.top - containerRect.top) + 'px';
    }
    
    // Återställ och skala context för DPR
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0); // Återställ transformation
      ctx.scale(dpr, dpr);
    }
  } else if (canvas && mapContainer) {
    // Fallback om SVG inte är laddad ännu - använd container-storlek
    const containerWidth = mapContainer.offsetWidth;
    const containerHeight = mapContainer.offsetHeight;
    
    const dpr = window.devicePixelRatio || 1;
    canvas.width = containerWidth * dpr;
    canvas.height = containerHeight * dpr;
    canvas.style.width = containerWidth + 'px';
    canvas.style.height = containerHeight + 'px';
    canvas.style.left = '0px';
    canvas.style.top = '0px';
    
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0); // Återställ transformation
      ctx.scale(dpr, dpr);
    }
  }
  
  // Använd requestAnimationFrame för att undvika blocking
 requestAnimationFrame(() => {
  if (points.length > 0 && mapSvg) {
    points.forEach(point => {
      if (point.svgX !== undefined && point.svgY !== undefined) {
        const screenPoint = svgToScreen(point.svgX, point.svgY);
        point.x = screenPoint.x;
        point.y = screenPoint.y;
      }
    });
  }
  
  // Rita om allt på canvas efter resize
  scheduleRedraw();
});
}


// =======================
// Karta
// =======================
function loadMap() {
  mapSvg = mapContainer?.querySelector("svg");
  if (mapSvg) {
    processMapSVG(null);
    return;
  }

  const localSvgPath = "https://raw.githubusercontent.com/Xayida83/SVG-map-world/refs/heads/master/world.svg";

  fetch(localSvgPath)
    .then(response => {
      if (response.ok) return response.text();
      throw new Error("Local SVG file not found");
    })
    .then(svgText => processMapSVG(svgText))
    .catch(error => {
      console.warn("Local SVG file not found, trying online version...", error);
      fetch("https://mapsvg.com/maps/world")
        .then(response => {
          if (response.ok) return response.text();
          throw new Error("Failed to load map");
        })
        .then(svgText => processMapSVG(svgText))
        .catch(error => {
          console.error("Error loading map:", error);
          loadAlternativeMap();
        });
    });
}

function cleanSVGContent(svgElement) {
  if (!svgElement) return;
  
  // Ta bort HTML-element först
  const htmlElements = svgElement.querySelectorAll("div, span, p, br");
  if (htmlElements.length > 0) {
    htmlElements.forEach(el => el.remove());
  }

  // Process paths i batch
  const paths = svgElement.querySelectorAll("path");
  const pathsToRemove = [];
  
  paths.forEach(path => {
    const dAttr = path.getAttribute("d");
    if (!dAttr) {
      pathsToRemove.push(path);
      return;
    }

    let cleaned = cleanPathData(dAttr);
    
    if (cleaned !== dAttr) {
      if (cleaned.length > 0) {
        path.setAttribute("d", cleaned);
      } else {
        pathsToRemove.push(path);
      }
    }
  });
  
  // Ta bort ogiltiga paths i batch
  if (pathsToRemove.length > 0) {
    pathsToRemove.forEach(path => path.remove());
  }
}

function cleanPathData(dAttr) {
  let cleaned = "";
  const match = dAttr.match(/^([mMlLhHvVcCsSqQtTaAzZ][^\\<&]*?)(?=\\u|<|&|$)/);
  
  if (match) {
    cleaned = match[1];
  } else {
    cleaned = dAttr
      .replace(/\\u[0-9a-fA-F]{4}.*$/gi, "")
      .replace(/<[^>]*>.*$/g, "")
      .replace(/&[a-zA-Z]+;.*$/g, "")
      .replace(/\\/g, "")
      .replace(/[^mMlLhHvVcCsSqQtTaAzZ\s\d.,\-+eE]/g, "")
      .trim();
  }

  const validChars = /[mMlLhHvVcCsSqQtTaAzZ\s\d.,\-+eE]/;
  let lastValidIndex = -1;
  for (let i = 0; i < cleaned.length; i++) {
    if (validChars.test(cleaned[i])) lastValidIndex = i; else break;
  }
  if (lastValidIndex >= 0) cleaned = cleaned.substring(0, lastValidIndex + 1).trim();

  if (cleaned && !/^[mMlLhHvVcCsSqQtTaAzZ]/.test(cleaned)) {
    const m2 = cleaned.match(/[mMlLhHvVcCsSqQtTaAzZ][^mMlLhHvVcCsSqQtTaAzZ]*/);
    if (m2) cleaned = m2[0]; else return "";
  }

  return cleaned;
}

function processMapSVG(svgText) {
  if (svgText) {
    mapContainer.innerHTML = svgText;
    mapSvg = mapContainer.querySelector("svg");
  } else {
    mapSvg = mapContainer.querySelector("svg");
  }

  if (mapSvg) {
    // Använd requestAnimationFrame för att undvika blocking
    requestAnimationFrame(() => {
      cleanSVGContent(mapSvg);
      setupSVGAttributes(mapSvg);
      styleMapPaths(mapSvg);

      // Rensa cache när kartan ändras
      cachedCountryPaths = null;
      cachedCountryPathsTimestamp = 0;

      // Använd requestAnimationFrame igen för att säkerställa att rendering är klar
      requestAnimationFrame(() => {
        // Uppdatera canvas-storlek efter att SVG har laddats och anpassats
        resizeCanvas();
        updatePoints();
        drawCircleBoundary();
      });
    });
  }
}

function setupSVGAttributes(svg) {
  // Kontrollera om SVG redan har en viewBox
  let viewBox = svg.getAttribute("viewBox");
  
  if (!viewBox) {
    // Om ingen viewBox finns, skapa en baserad på getBBox
    const bbox = svg.getBBox();
    viewBox = `${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}`;
  }
  
  // Parse viewBox för att säkerställa 16:9 aspect ratio
  const viewBoxValues = viewBox.split(/\s+/).map(Number);
  if (viewBoxValues.length >= 4) {
    const currentWidth = viewBoxValues[2];
    const currentHeight = viewBoxValues[3];
    const currentAspectRatio = currentWidth / currentHeight;
    const targetAspectRatio = 16 / 9;
    
    // Om aspect ratio inte är 16:9, anpassa viewBox
    if (Math.abs(currentAspectRatio - targetAspectRatio) > 0.01) {
      if (currentAspectRatio > targetAspectRatio) {
        // Bredare än 16:9 - öka höjden
        const newHeight = currentWidth / targetAspectRatio;
        const heightDiff = (newHeight - currentHeight) / 2;
        viewBox = `${viewBoxValues[0]} ${viewBoxValues[1] - heightDiff} ${currentWidth} ${newHeight}`;
      } else {
        // Högare än 16:9 - öka bredden
        const newWidth = currentHeight * targetAspectRatio;
        const widthDiff = (newWidth - currentWidth) / 2;
        viewBox = `${viewBoxValues[0] - widthDiff} ${viewBoxValues[1]} ${newWidth} ${currentHeight}`;
      }
    }
  }
  
  svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.style.width = "100%";
  svg.style.height = "100%";
}

function styleMapPaths(svg) {
  const paths = svg.querySelectorAll("path");
  paths.forEach(path => {
    path.setAttribute("fill", CONFIG.mapColors.fill);
    path.setAttribute("stroke", CONFIG.mapColors.stroke);
    path.setAttribute("stroke-width", CONFIG.mapColors.strokeWidth);
  });
}

function loadAlternativeMap() {
  // Använd 16:9 aspect ratio för fallback-kartan (1600x900)
  mapContainer.innerHTML = `
    <svg viewBox="0 0 1600 900" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" style="width: 100%; height: 100%;">
      <rect width="1600" height="900" fill="#0a0a0a"/>
      <text x="800" y="450" text-anchor="middle" fill="#fff" font-size="20">Laddar världskarta...</text>
      <text x="800" y="480" text-anchor="middle" fill="#888" font-size="14">Om kartan inte laddas, hosta SVG-filen lokalt</text>
    </svg>
  `;
  mapSvg = mapContainer.querySelector("svg");
  console.warn("Using fallback map. Host the SVG on your server for production.");
}

// =======================
// Hämtning & uppdatering
// =======================
function fetchDonationData() {
  return fetchData(API_URL)
    .then(({ amount }) => {
      previousAmount = currentAmount;
      currentAmount = amount;
      console.log("[AMOUNT]", currentAmount);
      console.log("[POINTS TO SHOW]", Math.floor(currentAmount / CONFIG.pricePerPoint));
      updatePoints();
    })
    .catch(error => {
      console.error("Kunde inte hämta donationsdata:", error);
      previousAmount = currentAmount;
      const mockData = getMockDonationData();
      currentAmount = Number(mockData.amount) || 0;
      console.log("[FALLBACK MOCK] +" + (mockData.amount - previousAmount) + " kr, totalt: " + currentAmount);
      console.log("[POINTS TO SHOW]", Math.floor(currentAmount / CONFIG.pricePerPoint));
      updatePoints();
    });
}

function startAutoUpdate() {
  if (updateTimer) clearInterval(updateTimer);
  updateTimer = setInterval(() => { 
    fetchDonationData();
  }, CONFIG.updateInterval * 1000);
}

function addTestDonation(amount) {
  const oldAmount = currentAmount;
  previousAmount = currentAmount;
  currentAmount += Number(amount) || 0;
  
  const pointsBefore = points.length;
  const newPointsExpected = Math.floor(Number(amount) / CONFIG.pricePerPoint);
  
  console.log(`[TEST DONATION] +${amount} kr`);
  console.log(`  Belopp: ${oldAmount} -> ${currentAmount}`);
  console.log(`  Förväntade nya prickar: ${newPointsExpected}`);
  console.log(`  Prickar innan: ${pointsBefore}`);
  
  updatePoints();
  
  const pointsAfter = points.length;
  const pointsAdded = pointsAfter - pointsBefore;
  const newPoints = points.filter(p => p.isNew);
  
  console.log(`  Prickar efter: ${pointsAfter}`);
  console.log(`  Prickar tillagda: ${pointsAdded}`);
  console.log(`  Nya prickar (isNew): ${newPoints.length}`);
  
  if (pointsAdded === 0 && newPointsExpected > 0) {
    console.warn("  - Inga prickar kunde placeras! Möjliga orsaker:");
    console.warn("     - Cirkelgränsen är för liten");
    console.warn("     - Inga länder hittades");
    console.warn("     - Alla försök misslyckades (för många prickar redan?)");
  }
}

// Förbättrad testfunktion med bättre feedback
function testNewPoints(count = 3) {
  const amount = count * CONFIG.pricePerPoint;
  console.log(`[TEST] Lägger till ${count} nya prickar (${amount} kr)...`);
  addTestDonation(amount);
  
  setTimeout(() => {
    const newPoints = points.filter(p => p.isNew);
    console.log(`[TEST] Nya prickar skapade: ${newPoints.length} av ${count} förväntade`);
    if (newPoints.length < count) {
      console.warn(`[TEST] Endast ${newPoints.length} av ${count} prickar kunde placeras`);
    }
  }, 100);
}

// =======================
// Punkter / rendering
// =======================
function updatePoints() {
  if (!mapSvg) return;

  const totalPoints = Math.floor(currentAmount / CONFIG.pricePerPoint);
  const previousPointsTotal = Math.floor(previousAmount / CONFIG.pricePerPoint);

  const donationDifference = currentAmount - previousAmount;
  const calculatedNewPointsRaw = Math.floor(donationDifference / CONFIG.pricePerPoint);

  // Om det är första laddningen, rensa canvas och prickar
  if (isFirstLoad && currentAmount > 0) {
    if (ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    points = [];
    isFirstLoad = false;
  }

  // Räkna totala antalet prickar (både vanliga och "nya")
  // Prickar ska INTE tas bort när de slutar vara "nya" - de blir bara vanliga prickar
  const totalExistingPoints = points.length;
  
  // Nya prickar ska bara skapas om det inte är första laddningen och det finns en skillnad
  const newPointsToAdd = (previousAmount > 0 && donationDifference > 0)
    ? Math.max(0, calculatedNewPointsRaw)
    : 0;
  
  // Beräkna hur många vanliga prickar som behövs
  // Vi måste ta hänsyn till att nya prickar också räknas som prickar
  const neededRegularPoints = Math.max(0, totalPoints - totalExistingPoints - newPointsToAdd);

  console.log("[UPDATE POINTS]", {
    previousAmount,
    currentAmount,
    donationDifference,
    totalPoints,
    totalExistingPoints,
    newPointsToAdd,
    neededRegularPoints
  });

  // Lägg i kö i stället för att skapa direkt
  pendingRegularPoints += neededRegularPoints;
  pendingNewPoints += newPointsToAdd;

  // Se till att placeringsloopen är igång
  ensurePlacementLoopRunning();
  
  // Uppdatera ljus-räknaren
  updateLightsCounter();
}

function ensurePlacementLoopRunning() {
  if (placementLoopRunning) return;
  placementLoopRunning = true;
  requestAnimationFrame(processPendingPoints);
}

function processPendingPoints() {
  if (!mapSvg) {
    placementLoopRunning = false;
    return;
  }

  let didWork = false;
  let countryPaths = null;
  let pointsAddedThisBatch = 0; // Spåra antal prickar som lades till i denna batch
  // Dynamisk batch-storlek: större batch för initial laddning, mindre för inkrementella uppdateringar
  const totalPending = pendingRegularPoints + pendingNewPoints;
  const isInitialLoad = totalPending > 5000; // Om mer än 5000 prickar väntar, det är initial laddning
  const batchSize = isInitialLoad 
    ? Math.min(CONFIG.maxPointsPerBatch * 2 || 4000, totalPending) // Dubbel batch för initial laddning
    : (CONFIG.maxPointsPerBatch || 200);

  // 1. Lägg ut vanliga prickar
  if (pendingRegularPoints > 0) {
    const toPlace = Math.min(batchSize, pendingRegularPoints);
    const startIndex = points.length;
    
    if (!countryPaths) {
      countryPaths = getCountryPaths();
    }

    placePointsSequentially(
      countryPaths.regionCountries,
      countryPaths.globalCountries,
      toPlace,
      true
    );

    const actuallyPlaced = points.length - startIndex;
    // Subtrahera faktiskt placerade prickar, inte bara försöket att placera
    pendingRegularPoints = Math.max(0, pendingRegularPoints - actuallyPlaced);
    pointsAddedThisBatch += actuallyPlaced;
    didWork = true;
  }

  // 2. Lägg ut "nya donationer"-prickar
  if (pendingNewPoints > 0) {
    const toPlace = Math.min(batchSize, pendingNewPoints);
    const startIndex = points.length;
    
    if (!countryPaths) {
      countryPaths = getCountryPaths();
    }

    placePointsSequentially(
      countryPaths.regionCountries,
      countryPaths.globalCountries,
      toPlace,
      false
    );

    const newPointsCount = points.length - startIndex;
    markNewPoints(startIndex);
    // Subtrahera faktiskt placerade prickar, inte bara försöket att placera
    pendingNewPoints = Math.max(0, pendingNewPoints - newPointsCount);
    pointsAddedThisBatch += newPointsCount;
    didWork = true;
  }

  // Rita bara nya prickar direkt på canvas utan att rensa (inkrementell rendering)
  if (didWork && pointsAddedThisBatch > 0) {
    // Hämta de prickar som just lades till
    const newlyAddedPoints = points.slice(points.length - pointsAddedThisBatch);
    drawNewPointsOnly(newlyAddedPoints);
    updateLightsCounter();
  }

   if (pendingRegularPoints > 0 || pendingNewPoints > 0) {
    requestAnimationFrame(processPendingPoints);
  } else {
    placementLoopRunning = false;
    // Se till att animationsloopen är igång för blink-effekten
    // Men bara om blink är aktiverad och antalet prickar är under gränsen
    if (!animationLoopRunning && CONFIG.imageBlinkEnabled && points.length > 0 && points.length <= CONFIG.maxPointsForBlink) {
      startAnimationLoop();
    }
    updateLightsCounter();
  }
}


// Hjälpfunktion för att kolla om en punkt ligger i ett land
function isPointInCountry(point, path) {
  if (!point.svgX || !point.svgY) return false;
  try {
    return isPointInPath(path, point.svgX, point.svgY);
  } catch {
    return false;
  }
}

// Hjälpfunktion för att räkna prickar per land
function countPointsInCountry(path) {
  let count = 0;
  for (const point of points) {
    if (isPointInCountry(point, path)) {
      count++;
    }
  }
  return count;
}

// Hjälpfunktion för att beräkna landets area
function getCountryArea(path) {
  try {
    const bbox = path.getBBox();
    return bbox.width * bbox.height;
  } catch {
    return 0;
  }
}

// Ny funktion för att placera prickar sekventiellt med rotation mellan länder och area-baserad fördelning
function placePointsSequentially(regionCountries, globalCountries, pointCount, enforceMinimum) {
  if (pointCount <= 0) return;
  
  // Beräkna fördelningen baserat på regionPercentage
  const regionPercentage = CONFIG.regionPercentage / 100;
  const sequenceLength = 100;
  const regionCountInSequence = Math.round(sequenceLength * regionPercentage);
  const globalCountInSequence = sequenceLength - regionCountInSequence;
  
  const sequence = [];
  for (let i = 0; i < regionCountInSequence; i++) {
    sequence.push('region');
  }
  for (let i = 0; i < globalCountInSequence; i++) {
    sequence.push('global');
  }
  
  // Blanda sekvensen för jämnare fördelning
  for (let i = sequence.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [sequence[i], sequence[j]] = [sequence[j], sequence[i]];
  }
  
  // Hjälpfunktion för att kontrollera om ett land är lågprioriterat
  function isLowPriority(path) {
    const countryId = getCountryId(path);
    if (!countryId) return false;
    const upperId = countryId.toUpperCase();
    // Kontrollera både 2- och 3-bokstäver ISO-koder
    // Först kontrollera 3-bokstäver (t.ex. "ISR")
    if (upperId.length >= 3 && LOW_PRIORITY_COUNTRIES[upperId.substring(0, 3)]) {
      return true;
    }
    // Sedan kontrollera 2-bokstäver (t.ex. "IS")
    if (upperId.length >= 2 && LOW_PRIORITY_COUNTRIES[upperId.substring(0, 2)]) {
      return true;
    }
    return false;
  }
  
  // Beräkna area och prickar för varje land
  const regionCountriesWithData = regionCountries.map(path => {
    const area = getCountryArea(path);
    const pointCount = countPointsInCountry(path);
    const isLowPriorityCountry = isLowPriority(path);
    return { path, area, pointCount, isLowPriority: isLowPriorityCountry };
  }).filter(c => c.area > 0); // Filtrera bort länder utan area
  
  const globalCountriesWithData = globalCountries.map(path => {
    const area = getCountryArea(path);
    const pointCount = countPointsInCountry(path);
    const isLowPriorityCountry = isLowPriority(path);
    return { path, area, pointCount, isLowPriority: isLowPriorityCountry };
  }).filter(c => c.area > 0);
  
  // Beräkna total area för viktning
  const totalRegionArea = regionCountriesWithData.reduce((sum, c) => sum + c.area, 0);
  const totalGlobalArea = globalCountriesWithData.reduce((sum, c) => sum + c.area, 0);
  
  // Funktion för att välja ett land baserat på area och antal prickar
  function selectCountry(countries, totalArea) {
    if (countries.length === 0) return null;
    
    // Beräkna vikt för varje land
    // Vikt = area * (1 / (pointCount + 1)) * priorityMultiplier
    // Detta ger större länder högre vikt, men länder med färre prickar får ännu högre vikt
    // Lågprioriterade länder får lägre vikt (50% av normal vikt)
    const LOW_PRIORITY_MULTIPLIER = 0.5; // Lågprioriterade länder får 50% av normal vikt
    const weights = countries.map(country => {
      const areaWeight = country.area / totalArea; // Proportionell till area
      const pointCountPenalty = 1 / (country.pointCount + 1); // Lägre prickar = högre vikt
      const priorityMultiplier = country.isLowPriority ? LOW_PRIORITY_MULTIPLIER : 1.0;
      return areaWeight * pointCountPenalty * priorityMultiplier;
    });
    
    // Beräkna total vikt
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    if (totalWeight === 0) {
      // Om alla har samma vikt, välj random
      return countries[Math.floor(Math.random() * countries.length)];
    }
    
    // Välj land baserat på viktad sannolikhet
    let random = Math.random() * totalWeight;
    for (let i = 0; i < countries.length; i++) {
      random -= weights[i];
      if (random <= 0) {
        return countries[i];
      }
    }
    
    // Fallback
    return countries[0];
  }
  
  // Placera prickar enligt sekvensen
  let placedCount = 0;
  let sequenceIndex = 0;
  let failedAttempts = 0;
  const maxFailedAttempts = pointCount * 20;
  
  while (placedCount < pointCount && failedAttempts < maxFailedAttempts) {
    const targetType = sequence[sequenceIndex % sequence.length];
    sequenceIndex++;
    
    let point = null;
    let attemptsForThisPoint = 0;
    const maxAttemptsPerPoint = 20; // Öka antal försök
    
    while (!point && attemptsForThisPoint < maxAttemptsPerPoint) {
      let selectedCountry = null;
      
      if (targetType === 'region' && regionCountriesWithData.length > 0 && totalRegionArea > 0) {
        selectedCountry = selectCountry(regionCountriesWithData, totalRegionArea);
      } else if (targetType === 'global' && globalCountriesWithData.length > 0 && totalGlobalArea > 0) {
        selectedCountry = selectCountry(globalCountriesWithData, totalGlobalArea);
      }
      
      if (selectedCountry) {
        point = findPointOnLand(selectedCountry.path, 500);
        
        if (point) {
          // Uppdatera antal prickar för detta land
          selectedCountry.pointCount++;
        }
      }
      
      attemptsForThisPoint++;
      if (!point) {
        failedAttempts++;
      }
    }
    
    if (point) {
      points.push(point);
      placedCount++;
    } else {
      failedAttempts++;
    }
  }
  
}

// Cache för country paths för att undvika upprepade querySelectorAll
let cachedCountryPaths = null;
let cachedCountryPathsTimestamp = 0;
const COUNTRY_PATHS_CACHE_TTL = 5000; // 5 sekunder

function getCountryPaths() {
  // Använd cache om den är giltig
  const now = Date.now();
  if (cachedCountryPaths && (now - cachedCountryPathsTimestamp) < COUNTRY_PATHS_CACHE_TTL) {
    return cachedCountryPaths;
  }

  const countryPaths = mapSvg.querySelectorAll("path");
  const regionCountries = [];
  const globalCountries = [];

  // Kombinera båda looparna till en
  countryPaths.forEach(path => {
    const countryId = getCountryId(path);
    if (!countryId) return;

    const upperId = countryId.toUpperCase().substring(0, 2);
    
    // Exkludera länder som finns i EXCLUDED_COUNTRIES
    if (EXCLUDED_COUNTRIES[upperId]) {
      return;
    }
    
    // Kontrollera om det är ett regionland
    if (REGION_COUNTRIES[upperId]) {
      regionCountries.push(path);
    } else {
      // För globala länder, kontrollera att de har area (fallback-logik)
      try {
        const bbox = path.getBBox();
        if (bbox.width > 0 && bbox.height > 0) {
          globalCountries.push(path);
        }
      } catch {
        // Om getBBox() misslyckas, hoppa över detta land
      }
    }
  });

  // Om inga regionländer hittades, lägg till alla giltiga länder i globalCountries
  if (regionCountries.length === 0 && globalCountries.length === 0) {
    countryPaths.forEach(path => {
      const countryId = getCountryId(path);
      if (!countryId) return;
      
      const upperId = countryId.toUpperCase().substring(0, 2);
      if (EXCLUDED_COUNTRIES[upperId]) return;
      
      try {
        const bbox = path.getBBox();
        if (bbox.width > 0 && bbox.height > 0) {
          globalCountries.push(path);
        }
      } catch {
        // Ignorera
      }
    });
  }

  const result = { regionCountries, globalCountries };
  
  // Spara i cache
  cachedCountryPaths = result;
  cachedCountryPathsTimestamp = now;
  
  return result;
}

function getCountryId(path) {
  // Prioritera class-attributet (används av den nya kartan)
  const className = path.getAttribute("class");
  if (className) return className;
  
  return path.getAttribute("data-id") ||
         path.getAttribute("id") ||
         path.getAttribute("data-name") ||
         path.getAttribute("data-code") ||
         "";
}

function markNewPoints(startIndex) {
  const newlyAddedPoints = points.slice(startIndex);
  newlyAddedPoints.forEach(point => {
    point.isNew = true;
    point.createdAt = Date.now();
  });

  // Rita nya prickar direkt (de ritas redan av drawNewPointsOnly i processPendingPoints)
  // Men se till att animationsloopen är igång för blink-effekten
  // Men bara om blink är aktiverad och antalet prickar är under gränsen
  if (!animationLoopRunning && CONFIG.imageBlinkEnabled && points.length > 0 && points.length <= CONFIG.maxPointsForBlink) {
    startAnimationLoop();
  }

  newlyAddedPoints.forEach(point => {
    setTimeout(() => {
      const idx = points.findIndex(p => p === point);
      if (idx !== -1 && points[idx]) {
        points[idx].isNew = false;
        // När prickar ändras från "nya" till vanliga, behöver vi rita om dem
        // Om animationsloopen körs hanterar den detta automatiskt
        // Om inte, måste vi rita om manuellt
        if (!animationLoopRunning) {
          scheduleRedraw();
        }
        
        // Kontrollera om blink-animation fortfarande används
        // Om antalet prickar är över gränsen, stoppas animationsloopen automatiskt i animate()
        const useBlinkAnimation = points.length <= CONFIG.maxPointsForBlink;
        
        // Om blink-animation inte längre används och animationsloopen körs, stoppa den
        if (!useBlinkAnimation && animationLoopRunning) {
          animationLoopRunning = false;
          scheduleRedraw(); // Rita en sista gång med fast opacity
        }
      }
    }, CONFIG.newDonationDuration * 1000);
  });
}

function findPointOnLand(path, maxAttempts = 100) {
  if (!mapSvg) return null;

  maxAttempts = maxAttempts || 100;
  let attempts = 0;

  while (attempts < maxAttempts) {
    try {
      const bbox = path.getBBox();
      if (bbox.width === 0 || bbox.height === 0) { attempts++; continue; }

      const x = bbox.x + Math.random() * bbox.width;
      const y = bbox.y + Math.random() * bbox.height;

      if (isPointInPath(path, x, y)) {
        const screenPoint = svgToScreen(x, y);
        if (isValidDistance(screenPoint.x, screenPoint.y) && 
            isPointInCircle(screenPoint.x, screenPoint.y)) {
          return createPoint(screenPoint.x, screenPoint.y, x, y);
        }
      }
    } catch { /* ignore */ }
    attempts++;
  }
  return null;
}

function createPoint(screenX, screenY, svgX, svgY) {
  return {
    x: screenX,
    y: screenY,
    svgX: svgX,
    svgY: svgY,
    isNew: false,
    createdAt: Date.now(),

    // Lite variation i storlek så det inte ser för "perfekt" ut
    sizeJitter: 0.8 + Math.random() * 0.6, // 0.8–1.4
    
    // Blink-animation: varje prick har sin egen fase och hastighet för glitter-effekt
    blinkPhase: Math.random() * Math.PI * 2, // 0 till 2π - slumpmässig startfase
    blinkSpeed: 0.5 + Math.random() * 1.5, // 0.5-2.0 sekunder per blink-cykel
    blinkMinOpacity: 0.2 + Math.random() * 0.3, // Minsta opacity (0.2-0.5)
    blinkMaxOpacity: 0.7 + Math.random() * 0.3 // Högsta opacity (0.7-1.0)
  };
}

function isPointInPath(path, x, y) {
  if (path.isPointInFill) {
    return path.isPointInFill(new DOMPoint(x, y));
  }
  const point = mapSvg.createSVGPoint();
  point.x = x; point.y = y;
  try { return path.isPointInFill(point); } catch { return true; }
}

// Optimerad version - använder squared distance för att undvika sqrt()
const minDistanceSquared = CONFIG.minDistance * CONFIG.minDistance;
function isValidDistance(screenX, screenY) {
  for (const existingPoint of points) {
    const dx = screenX - existingPoint.x;
    const dy = screenY - existingPoint.y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared < minDistanceSquared) return false;
  }
  return true;
}

function getCircleBoundaryData() {
  if (!mapContainer || !mapSvg) return null;
  
  // Använd samma koordinatsystem som prickarna (relativt till SVG/canvas)
  const svgRect = mapSvg.getBoundingClientRect();
  if (!svgRect.width || !svgRect.height) return null;
  
  // Beräkna minsta dimensionen av SVG (inte container)
  const minDimension = Math.min(svgRect.width, svgRect.height);
  
  // Beräkna cirkelns position relativt till SVG (samma system som prickarna)
  return {
    centerX: svgRect.width * CONFIG.circleBoundary.centerX,
    centerY: svgRect.height * CONFIG.circleBoundary.centerY,
    radius: minDimension * CONFIG.circleBoundary.radius
  };
}

function isPointInCircle(screenX, screenY) {
  if (!CONFIG.circleBoundary.enabled) return true;
  
  const circleData = getCircleBoundaryData();
  if (!circleData) return true;

  const dx = screenX - circleData.centerX;
  const dy = screenY - circleData.centerY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  return distance <= circleData.radius;
}

function svgToScreen(svgX, svgY) {
  if (!mapSvg || !mapContainer) return { x: svgX, y: svgY };
  
  try {
    const svgPoint = mapSvg.createSVGPoint();
    svgPoint.x = svgX;
    svgPoint.y = svgY;
    const ctm = mapSvg.getScreenCTM();
    if (ctm) {
      const screenPoint = svgPoint.matrixTransform(ctm);
      const svgRect = mapSvg.getBoundingClientRect();
      const containerRect = mapContainer.getBoundingClientRect();
      
      // Returnera koordinater relativt till SVG:s position (som matchar canvas-position)
      return {
        x: screenPoint.x - svgRect.left,
        y: screenPoint.y - svgRect.top
      };
    }
  } catch (e) {
    console.warn("Error in svgToScreen:", e);
  }

  // Fallback: använd viewBox och container-storlek
  const viewBox = mapSvg.viewBox.baseVal;
  const svgRect = mapSvg.getBoundingClientRect();
  if (viewBox.width && viewBox.height && svgRect.width && svgRect.height) {
    const scaleX = svgRect.width / viewBox.width;
    const scaleY = svgRect.height / viewBox.height;
    return {
      x: (svgX - viewBox.x) * scaleX,
      y: (svgY - viewBox.y) * scaleY
    };
  }
  return { x: svgX, y: svgY };
}

// Hjälpfunktion för att formatera färg med opacity
function formatColor(colorTemplate, opacity) {
  return colorTemplate.replace('{opacity}', opacity);
}

// Optimering för många prickar: batch-rendering och gruppering
let redrawScheduled = false;
let redrawAnimationFrame = null;
let animationLoopRunning = false;

function scheduleRedraw() {
  if (redrawScheduled) return;
  redrawScheduled = true;
  
  if (redrawAnimationFrame) {
    cancelAnimationFrame(redrawAnimationFrame);
  }
  
  redrawAnimationFrame = requestAnimationFrame(() => {
    redrawScheduled = false;
    redrawAnimationFrame = null;
    redrawPoints();
  });
  
  // Starta kontinuerlig animation-loop för glitter-effekt om den inte redan körs
  // Men bara om blink är aktiverad och antalet prickar är under gränsen
  if (!animationLoopRunning && CONFIG.imageBlinkEnabled && points.length > 0 && points.length <= CONFIG.maxPointsForBlink) {
    startAnimationLoop();
  }
}

function startAnimationLoop() {
  if (animationLoopRunning) return;
  // Starta inte animationsloopen om blink är inaktiverad eller om det finns för många prickar
  if (!CONFIG.imageBlinkEnabled || points.length > CONFIG.maxPointsForBlink) {
    return;
  }
  animationLoopRunning = true;
  
  function animate() {
    if (points.length === 0) {
      animationLoopRunning = false;
      return;
    }
    
    // Stoppa animationen om blink är inaktiverad eller om antalet prickar överstiger gränsen
    if (!CONFIG.imageBlinkEnabled || points.length > CONFIG.maxPointsForBlink) {
      animationLoopRunning = false;
      // Rita en sista gång med fast opacity
      redrawPoints();
      return;
    }
    
    // Kontrollera om blink-animation faktiskt används
    // Om antalet prickar är över gränsen, används fast opacity och ingen blink-animation
    const useBlinkAnimation = points.length <= CONFIG.maxPointsForBlink;
    
    // Om blink-animation inte används, stoppa animationsloopen
    if (!useBlinkAnimation) {
      animationLoopRunning = false;
      // Rita en sista gång med fast opacity
      redrawPoints();
      return;
    }
    
    // Rita om prickar med uppdaterad blink-animation
    redrawPoints();
    
    // Fortsätt animationen
    requestAnimationFrame(animate);
  }
  
  animate();
}

// Rita bara nya prickar direkt på canvas utan att rensa (inkrementell rendering)
// För vanliga prickar ritas de med vanlig stil, för "nya" prickar med extra glöd
// 
// OBS: Opacity i canvas fungerar via rgba()-färger (t.ex. rgba(255, 223, 128, 0.5))
// eller ctx.globalAlpha. Med globalCompositeOperation: 'screen' fungerar opacity
// korrekt - lägre opacity-värden ger mer transparenta prickar som blinkar mjukt.
function drawNewPointsOnly(newPoints) {
  if (!ctx || !canvas || !newPoints || newPoints.length === 0) return;

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  
  // Separera nya prickar från vanliga prickar
  const regularNewPoints = [];
  const highlightedNewPoints = [];
  
  for (const point of newPoints) {
    if (point.isNew) {
      highlightedNewPoints.push(point);
    } else {
      regularNewPoints.push(point);
    }
  }

  // Kontrollera om blink-animation ska användas
  const pointCount = points.length;
  const useBlinkAnimation = pointCount <= CONFIG.maxPointsForBlink;
  
  // Beräkna aktuell tid för blink-animation (endast om blink-animation används)
  const currentTime = useBlinkAnimation ? Date.now() / 1000 : 0;

  // Rita vanliga prickar först
  if (regularNewPoints.length > 0) {
    for (const point of regularNewPoints) {
      const jitter = point.sizeJitter || 1;
      
      // Använd blink-animation eller fast opacity beroende på konfiguration
      let opacity;
      const shouldBlink = CONFIG.imageBlinkEnabled && useBlinkAnimation;
      
      if (shouldBlink) {
        // Blink-animation för vanliga prickar
        const blinkPhase = point.blinkPhase || 0;
        const blinkSpeed = point.blinkSpeed || 1.0;
        const minOpacity = point.blinkMinOpacity !== undefined ? point.blinkMinOpacity : 0.3;
        const maxOpacity = point.blinkMaxOpacity !== undefined ? point.blinkMaxOpacity : 0.8;
        
        const blinkValue = Math.sin((currentTime * Math.PI * 2 / blinkSpeed) + blinkPhase);
        opacity = minOpacity + (blinkValue + 1) / 2 * (maxOpacity - minOpacity);
      } else {
        // Använd fast opacity (medelvärde av min och max)
        const minOpacity = point.blinkMinOpacity !== undefined ? point.blinkMinOpacity : 0.3;
        const maxOpacity = point.blinkMaxOpacity !== undefined ? point.blinkMaxOpacity : 0.8;
        opacity = (minOpacity + maxOpacity) / 2;
      }
      
      // Rita bild (inga fallback-cirklar)
      if (imagesLoaded && regularImage && regularImage.complete) {
        const size = CONFIG.imageSizes.regular * jitter;
        ctx.globalAlpha = opacity;
        ctx.drawImage(regularImage, point.x - size / 2, point.y - size / 2, size, size);
        ctx.globalAlpha = 1.0; // Återställ
      }
    }
  }

  // Rita "nya" prickar (större bilder)
  if (highlightedNewPoints.length > 0) {
    for (const point of highlightedNewPoints) {
      const jitter = point.sizeJitter || 1;
      
      // Använd blink-animation eller fast opacity beroende på konfiguration
      let opacity;
      const shouldBlink = CONFIG.imageBlinkEnabled && useBlinkAnimation;
      
      if (shouldBlink) {
        // Nya prickar blinkar också, men med högre bas-opacity och starkare ljus
        const blinkPhase = point.blinkPhase || 0;
        const blinkSpeed = point.blinkSpeed || 1.0;
        const minOpacity = 0.7; // Högre minimum för starkare ljus
        const maxOpacity = 1.0;
        
        const blinkValue = Math.sin((currentTime * Math.PI * 2 / blinkSpeed) + blinkPhase);
        opacity = minOpacity + (blinkValue + 1) / 2 * (maxOpacity - minOpacity);
      } else {
        // Använd fast opacity (medelvärde)
        opacity = 0.85; // Medelvärde av 0.7 och 1.0
      }
      
      // Rita bild
      if (imagesLoaded && newImage && newImage.complete) {
        const size = CONFIG.imageSizes.new * jitter;
        ctx.globalAlpha = opacity;
        ctx.drawImage(newImage, point.x - size / 2, point.y - size / 2, size, size);
        ctx.globalAlpha = 1.0; // Återställ
      }
    }
  }

  ctx.restore();
  
  // Se till att animationsloopen är igång för blink-effekten
  // Men bara om blink är aktiverad och antalet prickar är under gränsen
  if (!animationLoopRunning && CONFIG.imageBlinkEnabled && points.length > 0 && points.length <= CONFIG.maxPointsForBlink) {
    startAnimationLoop();
  }
}

function redrawPoints() {
  if (!ctx || !canvas) return;

  const pointCount = points.length;
  
  // Om det är för många prickar, använd optimerad batch-rendering
  if (pointCount > 5000) {
    redrawPointsOptimized();
    return;
  }

  // Rensa hela canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Rita cirkelgränsen först (om du använder den)
  if (CONFIG.circleBoundary.enabled && CONFIG.circleBoundary.showVisual) {
    drawCircleBoundary();
  }

  ctx.save();
  ctx.globalCompositeOperation = 'screen';

  // Gruppera prickar efter typ för att minska state-ändringar
  const newPoints = [];
  const regularPoints = [];
  
  for (const point of points) {
    if (point.isNew) {
      newPoints.push(point);
    } else {
      regularPoints.push(point);
    }
  }

  // Kontrollera om blink-animation ska användas
  const useBlinkAnimation = pointCount <= CONFIG.maxPointsForBlink;
  
  // Beräkna aktuell tid för blink-animation (endast om blink-animation används)
  const currentTime = useBlinkAnimation ? Date.now() / 1000 : 0;
  
  // Rita vanliga prickar först
  if (regularPoints.length > 0) {
    for (const point of regularPoints) {
      const jitter = point.sizeJitter || 1;
      
      // Använd blink-animation eller fast opacity beroende på konfiguration
      let opacity;
      const shouldBlink = CONFIG.imageBlinkEnabled && useBlinkAnimation;
      
      if (shouldBlink) {
        // Beräkna blink-opacity baserat på tid och punktens egna parametrar
        const blinkPhase = point.blinkPhase || 0;
        const blinkSpeed = point.blinkSpeed || 1.0;
        const minOpacity = point.blinkMinOpacity !== undefined ? point.blinkMinOpacity : 0.3;
        const maxOpacity = point.blinkMaxOpacity !== undefined ? point.blinkMaxOpacity : 0.8;
        
        // Använd sinusvåg för mjuk blink-effekt
        const blinkValue = Math.sin((currentTime * Math.PI * 2 / blinkSpeed) + blinkPhase);
        // Normalisera från -1..1 till minOpacity..maxOpacity
        opacity = minOpacity + (blinkValue + 1) / 2 * (maxOpacity - minOpacity);
      } else {
        // Använd fast opacity (medelvärde av min och max)
        const minOpacity = point.blinkMinOpacity !== undefined ? point.blinkMinOpacity : 0.3;
        const maxOpacity = point.blinkMaxOpacity !== undefined ? point.blinkMaxOpacity : 0.8;
        opacity = (minOpacity + maxOpacity) / 2;
      }
      
      // Rita bild (inga fallback-cirklar)
      if (imagesLoaded && regularImage && regularImage.complete) {
        const size = CONFIG.imageSizes.regular * jitter;
        ctx.globalAlpha = opacity;
        ctx.drawImage(regularImage, point.x - size / 2, point.y - size / 2, size, size);
        ctx.globalAlpha = 1.0; // Återställ
      }
    }
  }

  // Rita nya prickar (större bilder)
  if (newPoints.length > 0) {
    for (const point of newPoints) {
      const jitter = point.sizeJitter || 1;
      
      // Använd blink-animation eller fast opacity beroende på konfiguration
      let opacity;
      const shouldBlink = CONFIG.imageBlinkEnabled && useBlinkAnimation;
      
      if (shouldBlink) {
        // Nya prickar blinkar också, men med högre bas-opacity och starkare ljus
        const blinkPhase = point.blinkPhase || 0;
        const blinkSpeed = point.blinkSpeed || 1.0;
        const minOpacity = 0.7; // Högre minimum för starkare ljus
        const maxOpacity = 1.0;
        
        const blinkValue = Math.sin((currentTime * Math.PI * 2 / blinkSpeed) + blinkPhase);
        opacity = minOpacity + (blinkValue + 1) / 2 * (maxOpacity - minOpacity);
      } else {
        // Använd fast opacity (medelvärde)
        opacity = 0.85; // Medelvärde av 0.7 och 1.0
      }
      
      // Rita bild
      if (imagesLoaded && newImage && newImage.complete) {
        const size = CONFIG.imageSizes.new * jitter;
        ctx.globalAlpha = opacity;
        ctx.drawImage(newImage, point.x - size / 2, point.y - size / 2, size, size);
        ctx.globalAlpha = 1.0; // Återställ
      }
    }
  }

  ctx.restore();
}

// Optimerad version för många prickar (>5000)
function redrawPointsOptimized() {
  if (!ctx || !canvas) return;

  // Rensa hela canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Rita cirkelgränsen först (om du använder den)
  if (CONFIG.circleBoundary.enabled && CONFIG.circleBoundary.showVisual) {
    drawCircleBoundary();
  }

  ctx.save();
  ctx.globalCompositeOperation = 'screen';

  // För många prickar: använd enklare rendering utan shadowBlur för bättre prestanda
  // Gruppera prickar efter typ
  const newPoints = [];
  const regularPoints = [];
  
  for (const point of points) {
    if (point.isNew) {
      newPoints.push(point);
    } else {
      regularPoints.push(point);
    }
  }

  const pointCount = points.length;
  // Kontrollera om blink-animation ska användas
  const useBlinkAnimation = pointCount <= CONFIG.maxPointsForBlink;
  
  // Beräkna aktuell tid för blink-animation (endast om blink-animation används)
  const currentTime = useBlinkAnimation ? Date.now() / 1000 : 0;
  
  // Rita vanliga prickar med enklare stil (ingen shadow för snabbare rendering)
  if (regularPoints.length > 0) {
    for (const point of regularPoints) {
      const jitter = point.sizeJitter || 1;
      
      // Använd blink-animation eller fast opacity beroende på konfiguration
      let opacity;
      const shouldBlink = CONFIG.imageBlinkEnabled && useBlinkAnimation;
      
      if (shouldBlink) {
        // Blink-animation även för optimerad version
        const blinkPhase = point.blinkPhase || 0;
        const blinkSpeed = point.blinkSpeed || 1.0;
        const minOpacity = point.blinkMinOpacity !== undefined ? point.blinkMinOpacity : 0.3;
        const maxOpacity = point.blinkMaxOpacity !== undefined ? point.blinkMaxOpacity : 0.8;
        
        const blinkValue = Math.sin((currentTime * Math.PI * 2 / blinkSpeed) + blinkPhase);
        opacity = minOpacity + (blinkValue + 1) / 2 * (maxOpacity - minOpacity);
      } else {
        // Använd fast opacity (medelvärde av min och max)
        const minOpacity = point.blinkMinOpacity !== undefined ? point.blinkMinOpacity : 0.3;
        const maxOpacity = point.blinkMaxOpacity !== undefined ? point.blinkMaxOpacity : 0.8;
        opacity = (minOpacity + maxOpacity) / 2;
      }
      
      // Rita bild (inga fallback-cirklar)
      if (imagesLoaded && regularImage && regularImage.complete) {
        const size = CONFIG.imageSizes.regular * jitter;
        ctx.globalAlpha = opacity;
        ctx.drawImage(regularImage, point.x - size / 2, point.y - size / 2, size, size);
        ctx.globalAlpha = 1.0; // Återställ
      }
    }
  }

  // Rita nya prickar (större bilder)
  if (newPoints.length > 0) {
    for (const point of newPoints) {
      const jitter = point.sizeJitter || 1;
      
      // Använd blink-animation eller fast opacity beroende på konfiguration
      let opacity;
      const shouldBlink = CONFIG.imageBlinkEnabled && useBlinkAnimation;
      
      if (shouldBlink) {
        // Nya prickar blinkar också med högre opacity
        const blinkPhase = point.blinkPhase || 0;
        const blinkSpeed = point.blinkSpeed || 1.0;
        const minOpacity = 0.7; // Högre minimum för starkare ljus
        const maxOpacity = 1.0;
        
        const blinkValue = Math.sin((currentTime * Math.PI * 2 / blinkSpeed) + blinkPhase);
        opacity = minOpacity + (blinkValue + 1) / 2 * (maxOpacity - minOpacity);
      } else {
        // Använd fast opacity (medelvärde)
        opacity = 0.85; // Medelvärde av 0.7 och 1.0
      }
      
      // Rita bild
      if (imagesLoaded && newImage && newImage.complete) {
        const size = CONFIG.imageSizes.new * jitter;
        ctx.globalAlpha = opacity;
        ctx.drawImage(newImage, point.x - size / 2, point.y - size / 2, size, size);
        ctx.globalAlpha = 1.0; // Återställ
      }
    }
  }

  ctx.restore();
}

function drawCircleBoundary() {
  if (!ctx || !mapContainer || !CONFIG.circleBoundary.enabled || !CONFIG.circleBoundary.showVisual) {
    return;
  }

  const circleData = getCircleBoundaryData();
  if (!circleData) return;

  ctx.save();
  ctx.beginPath();
  ctx.arc(circleData.centerX, circleData.centerY, circleData.radius, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 2;
  ctx.stroke();
  
  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.fill();
  ctx.restore();
}

// Uppdatera ljus-räknaren med antalet prickar
function updateLightsCounter() {
  const lightsAmountEl = document.getElementById("lightsAmount");
  if (lightsAmountEl) {
    const totalLights = points.length;
    lightsAmountEl.textContent = totalLights.toLocaleString('sv-SE');
  }
}

