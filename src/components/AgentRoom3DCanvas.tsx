import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface PipelineJob {
  id: string;
  filename: string;
  title: string;
  folder: string;
  tags: string[];
  reason?: string;
}

export type PipelinePhase =
  | 'idle'
  | 'dropping'
  | 'courier_to_inbox'
  | 'courier_to_github'
  | 'github_sync'
  | 'gemini_to_github'
  | 'gemini_to_desk'
  | 'ai_processing'
  | 'librarian_to_desk'
  | 'librarian_to_shelf'
  | 'shelving_and_stamp'
  | 'return_idle';

export type LiveWorkflowStage = 'idle' | 'github' | 'ai' | 'deploy' | null;
export type CameraPreset = 'iso' | 'front' | 'desk';

interface AgentRoom3DCanvasProps {
  dropBatch: { seq: number; jobs: PipelineJob[] } | null;
  stopSeq: number;
  speed: 1 | 2;
  cameraPreset: { seq: number; preset: CameraPreset };
  liveStage: LiveWorkflowStage;
  onStateChange?: (info: {
    phase: PipelinePhase;
    currentJob: PipelineJob | null;
    queueCount: number;
  }) => void;
}

interface CharacterRig {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  carryAnchor: THREE.Group;
  headAnchor: THREE.Object3D;
  homePos: THREE.Vector3;
  homeRotY: number;
  carrying: boolean;
  walkPhase: number;
}

interface PackageRig {
  root: THREE.Group;
  leftFlap: THREE.Group;
  rightFlap: THREE.Group;
  paper: THREE.Group;
  boxBody: THREE.Group;
}

interface BubbleTexts {
  courier?: string;
  archivist?: string;
  librarian?: string;
  github?: string;
}

// Steno vintage palette
const COL = {
  ivory: 0xf7f5ee,
  paper: 0xffffff,
  woodLight: 0xd7b996,
  woodWarm: 0xb98b60,
  woodDark: 0x6e4e35,
  ink: 0x233329,
  mint: 0x7fa195,
  mintBright: 0x56b895,
  terracotta: 0xc1664b,
  kraft: 0xd5ad79,
  tape: 0xefe3c8,
  brass: 0xe6b85c,
  skin: 0xf9efe2,
};

const STATIONS = {
  inbox: new THREE.Vector3(-5.3, 0, -0.1),
  inboxPickup: new THREE.Vector3(-4.2, 0, 0.55),
  githubSlot: new THREE.Vector3(-1.8, 0, -0.85),
  githubDrop: new THREE.Vector3(-1.8, 0, 0.35),
  githubOut: new THREE.Vector3(-1.05, 0, 0.45),
  deskCenter: new THREE.Vector3(1.85, 0, -0.35),
  deskLeft: new THREE.Vector3(1.55, 0, 0.95),
  deskRight: new THREE.Vector3(2.85, 0, 0.75),
  shelfStand: new THREE.Vector3(4.85, 0, 0.65),
  ledgerStand: new THREE.Vector3(4.55, 0, 1.55),
};

function lerpAngle(current: number, target: number, t: number): number {
  let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * t;
}

function createCharacter(
  role: 'courier' | 'archivist' | 'librarian',
  homePos: THREE.Vector3,
  homeRotY: number
): CharacterRig {
  const root = new THREE.Group();
  root.position.copy(homePos);
  root.rotation.y = homeRotY;

  const bodyColor =
    role === 'courier' ? COL.terracotta : role === 'archivist' ? COL.mint : COL.ink;

  const body = new THREE.Group();
  root.add(body);

  // Torso
  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(0.56, 0.68, 0.36),
    new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.65 })
  );
  torso.position.y = 0.74;
  torso.castShadow = true;
  torso.receiveShadow = true;
  body.add(torso);

  // Shirt collar / accent
  const badge = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.22, 0.04),
    new THREE.MeshStandardMaterial({ color: COL.ivory, roughness: 0.5 })
  );
  badge.position.set(0, 0.8, 0.19);
  body.add(badge);

  // Head
  const head = new THREE.Group();
  head.position.set(0, 1.24, 0);
  body.add(head);

  const cranium = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.44, 0.44),
    new THREE.MeshStandardMaterial({ color: COL.skin, roughness: 0.6 })
  );
  cranium.position.y = 0.12;
  cranium.castShadow = true;
  head.add(cranium);

  // Eyes
  const eyeMat = new THREE.MeshStandardMaterial({ color: COL.ink, roughness: 0.4 });
  const leftEye = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.04), eyeMat);
  leftEye.position.set(-0.1, 0.13, 0.22);
  const rightEye = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.04), eyeMat);
  rightEye.position.set(0.1, 0.13, 0.22);
  head.add(leftEye, rightEye);

  // Role accessories
  if (role === 'courier') {
    const capTop = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.15, 0.48),
      new THREE.MeshStandardMaterial({ color: COL.terracotta, roughness: 0.55 })
    );
    capTop.position.set(0, 0.38, 0);
    capTop.castShadow = true;
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.05, 0.22),
      new THREE.MeshStandardMaterial({ color: COL.ink, roughness: 0.5 })
    );
    visor.position.set(0, 0.32, 0.26);
    const backpack = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.48, 0.2),
      new THREE.MeshStandardMaterial({ color: COL.woodWarm, roughness: 0.7 })
    );
    backpack.position.set(0, 0.75, -0.26);
    backpack.castShadow = true;
    head.add(capTop, visor);
    body.add(backpack);
  } else if (role === 'archivist') {
    const hair = new THREE.Mesh(
      new THREE.BoxGeometry(0.49, 0.12, 0.48),
      new THREE.MeshStandardMaterial({ color: COL.ink, roughness: 0.7 })
    );
    hair.position.set(0, 0.36, -0.01);
    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.07, 0),
      new THREE.MeshStandardMaterial({
        color: COL.mintBright,
        emissive: COL.mintBright,
        emissiveIntensity: 0.7,
      })
    );
    gem.position.set(0, 0.48, 0.18);
    // Glasses rims
    const rimMat = new THREE.MeshStandardMaterial({ color: COL.ink });
    const rimL = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.014, 6, 14), rimMat);
    rimL.position.set(-0.1, 0.13, 0.24);
    const rimR = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.014, 6, 14), rimMat);
    rimR.position.set(0.1, 0.13, 0.24);
    head.add(hair, gem, rimL, rimR);
  } else {
    const hat = new THREE.Mesh(
      new THREE.BoxGeometry(0.48, 0.12, 0.46),
      new THREE.MeshStandardMaterial({ color: COL.woodDark, roughness: 0.7 })
    );
    hat.position.set(0, 0.36, 0);
    const bowtie = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.07, 0.05),
      new THREE.MeshStandardMaterial({ color: COL.terracotta })
    );
    bowtie.position.set(0, 1.04, 0.19);
    head.add(hat);
    body.add(bowtie);
  }

  // Head bubble anchor
  const headAnchor = new THREE.Object3D();
  headAnchor.position.set(0, 2.05, 0);
  root.add(headAnchor);

  // Limbs (pivoted at shoulder/hip)
  const makeLimb = (w: number, h: number, d: number, color: number, x: number, y: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.65 })
    );
    mesh.position.y = -h / 2;
    mesh.castShadow = true;
    pivot.add(mesh);
    return pivot;
  };

  const leftArm = makeLimb(0.16, 0.48, 0.16, bodyColor, -0.37, 1.02);
  const rightArm = makeLimb(0.16, 0.48, 0.16, bodyColor, 0.37, 1.02);
  const leftLeg = makeLimb(0.18, 0.4, 0.18, COL.ink, -0.14, 0.4);
  const rightLeg = makeLimb(0.18, 0.4, 0.18, COL.ink, 0.14, 0.4);
  body.add(leftArm, rightArm, leftLeg, rightLeg);

  // Anchor in front of chest for carried items
  const carryAnchor = new THREE.Group();
  carryAnchor.position.set(0, 0.8, 0.48);
  body.add(carryAnchor);

  return {
    root,
    body,
    head,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    carryAnchor,
    headAnchor,
    homePos: homePos.clone(),
    homeRotY,
    carrying: false,
    walkPhase: 0,
  };
}

function createPackageMesh(): PackageRig {
  const root = new THREE.Group();

  const boxBody = new THREE.Group();
  root.add(boxBody);

  const kraftMat = new THREE.MeshStandardMaterial({ color: COL.kraft, roughness: 0.8 });
  const insideMat = new THREE.MeshStandardMaterial({ color: 0x9b774d, roughness: 0.9 });

  // Open-top box walls
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.06, 0.54), kraftMat);
  bottom.position.y = 0.03;
  bottom.castShadow = true;
  const front = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.38, 0.05), kraftMat);
  front.position.set(0, 0.22, 0.245);
  front.castShadow = true;
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.38, 0.05), kraftMat);
  back.position.set(0, 0.22, -0.245);
  back.castShadow = true;
  const leftW = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.38, 0.46), kraftMat);
  leftW.position.set(-0.245, 0.22, 0);
  leftW.castShadow = true;
  const rightW = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.38, 0.46), kraftMat);
  rightW.position.set(0.245, 0.22, 0);
  rightW.castShadow = true;
  const innerCore = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.28, 0.44), insideMat);
  innerCore.position.y = 0.16;

  // Shipping label on front
  const label = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.18, 0.015),
    new THREE.MeshStandardMaterial({ color: COL.paper, roughness: 0.4 })
  );
  label.position.set(0, 0.23, 0.275);
  const labelStripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.04, 0.016),
    new THREE.MeshStandardMaterial({ color: COL.terracotta })
  );
  labelStripe.position.set(0, 0.27, 0.276);

  boxBody.add(bottom, front, back, leftW, rightW, innerCore, label, labelStripe);

  // Hinged top flaps
  const leftFlap = new THREE.Group();
  leftFlap.position.set(-0.26, 0.41, 0);
  const leftFlapMesh = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.03, 0.52), kraftMat);
  leftFlapMesh.position.x = 0.135;
  leftFlapMesh.castShadow = true;
  leftFlap.add(leftFlapMesh);

  const rightFlap = new THREE.Group();
  rightFlap.position.set(0.26, 0.41, 0);
  const rightFlapMesh = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.03, 0.52), kraftMat);
  rightFlapMesh.position.x = -0.135;
  rightFlapMesh.castShadow = true;
  rightFlap.add(rightFlapMesh);

  boxBody.add(leftFlap, rightFlap);

  // Floating document sheets inside box (revealed during AI processing)
  const paper = new THREE.Group();
  paper.position.set(0, 0.22, 0);
  paper.visible = false;
  const sheet = new THREE.Mesh(
    new THREE.BoxGeometry(0.36, 0.44, 0.03),
    new THREE.MeshStandardMaterial({
      color: COL.paper,
      emissive: COL.mint,
      emissiveIntensity: 0.18,
    })
  );
  const line1 = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.03, 0.04),
    new THREE.MeshStandardMaterial({ color: COL.ink })
  );
  line1.position.set(0, 0.1, 0);
  const line2 = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.03, 0.04),
    new THREE.MeshStandardMaterial({ color: COL.mintBright })
  );
  line2.position.set(-0.02, 0.01, 0);
  const line3 = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.03, 0.04),
    new THREE.MeshStandardMaterial({ color: COL.terracotta })
  );
  line3.position.set(0, -0.08, 0);
  paper.add(sheet, line1, line2, line3);
  root.add(paper);

  return { root, leftFlap, rightFlap, paper, boxBody };
}

function createBookMesh(color: number): THREE.Group {
  const g = new THREE.Group();
  const cover = new THREE.Mesh(
    new THREE.BoxGeometry(0.38, 0.12, 0.48),
    new THREE.MeshStandardMaterial({ color, roughness: 0.6 })
  );
  cover.position.y = 0.06;
  cover.castShadow = true;
  const pages = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.09, 0.44),
    new THREE.MeshStandardMaterial({ color: COL.ivory, roughness: 0.5 })
  );
  pages.position.set(0.02, 0.06, 0);
  const spineBand = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.125, 0.16),
    new THREE.MeshStandardMaterial({ color: COL.brass, roughness: 0.4 })
  );
  spineBand.position.set(-0.17, 0.06, 0);
  g.add(cover, pages, spineBand);
  return g;
}

export function AgentRoom3DCanvas({
  dropBatch,
  stopSeq,
  speed,
  cameraPreset,
  liveStage,
  onStateChange,
}: AgentRoom3DCanvasProps) {
  const mountRef = useRef<HTMLDivElement>(null);

  // Bubble DOM refs (60fps direct transform updates without React re-renders)
  const courierBubbleEl = useRef<HTMLDivElement>(null);
  const archivistBubbleEl = useRef<HTMLDivElement>(null);
  const librarianBubbleEl = useRef<HTMLDivElement>(null);
  const githubBubbleEl = useRef<HTMLDivElement>(null);

  const stationEls = useRef<Record<'inbox' | 'github' | 'desk' | 'shelf', HTMLDivElement | null>>({
    inbox: null,
    github: null,
    desk: null,
    shelf: null,
  });

  const [bubbles, setBubbles] = useState<BubbleTexts>({});

  // Shared mutable simulation state read by requestAnimationFrame
  const simRef = useRef<{
    queue: PipelineJob[];
    currentJob: PipelineJob | null;
    phase: PipelinePhase;
    elapsed: number;
    speed: 1 | 2;
    liveStage: LiveWorkflowStage;
    pkgVelY: number;
    pkgBounced: boolean;
    lastNotifiedPhase: string;
    lastNotifiedJobId: string;
    shelvedCount: number;
    shelfBooks: THREE.Group[];
    cameraTargetPos: THREE.Vector3 | null;
    cameraTargetLook: THREE.Vector3 | null;
    resetSceneRequested: boolean;
  }>({
    queue: [],
    currentJob: null,
    phase: 'idle',
    elapsed: 0,
    speed: 1,
    liveStage: null,
    pkgVelY: 0,
    pkgBounced: false,
    lastNotifiedPhase: '',
    lastNotifiedJobId: '',
    shelvedCount: 0,
    shelfBooks: [],
    cameraTargetPos: null,
    cameraTargetLook: null,
    resetSceneRequested: false,
  });

  const setBubbleSafe = useRef((next: BubbleTexts) => {
    setBubbles((prev) => {
      if (
        prev.courier === next.courier &&
        prev.archivist === next.archivist &&
        prev.librarian === next.librarian &&
        prev.github === next.github
      ) {
        return prev;
      }
      return next;
    });
  });

  // Sync props into simRef
  useEffect(() => {
    simRef.current.speed = speed;
  }, [speed]);

  useEffect(() => {
    simRef.current.liveStage = liveStage;
  }, [liveStage]);

  useEffect(() => {
    if (!dropBatch || dropBatch.jobs.length === 0) return;
    simRef.current.queue.push(...dropBatch.jobs);
  }, [dropBatch]);

  useEffect(() => {
    if (stopSeq === 0) return;
    simRef.current.queue = [];
    simRef.current.currentJob = null;
    simRef.current.phase = 'idle';
    simRef.current.elapsed = 0;
    simRef.current.resetSceneRequested = true;
    setBubbleSafe.current({});
  }, [stopSeq]);

  useEffect(() => {
    if (cameraPreset.seq === 0) return;
    if (cameraPreset.preset === 'iso') {
      simRef.current.cameraTargetPos = new THREE.Vector3(0.4, 9.8, 13.8);
      simRef.current.cameraTargetLook = new THREE.Vector3(0, 0.8, 0);
    } else if (cameraPreset.preset === 'front') {
      simRef.current.cameraTargetPos = new THREE.Vector3(0, 5.2, 14.2);
      simRef.current.cameraTargetLook = new THREE.Vector3(0, 1.0, -0.2);
    } else if (cameraPreset.preset === 'desk') {
      simRef.current.cameraTargetPos = new THREE.Vector3(2.2, 4.4, 5.8);
      simRef.current.cameraTargetLook = new THREE.Vector3(1.8, 1.1, -0.3);
    }
  }, [cameraPreset]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // 1. Scene, Camera, Renderer
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf4f0e4);
    scene.fog = new THREE.Fog(0xf4f0e4, 24, 44);

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 420;
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 80);
    camera.position.set(0.4, 9.8, 13.8);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0.8, 0);
    controls.maxPolarAngle = Math.PI / 2.12;
    controls.minDistance = 5.5;
    controls.maxDistance = 24;

    // Cancel camera preset lerp if user starts dragging
    const onControlStart = () => {
      simRef.current.cameraTargetPos = null;
      simRef.current.cameraTargetLook = null;
    };
    controls.addEventListener('start', onControlStart);

    // 2. Lighting
    const ambient = new THREE.AmbientLight(0xfff9ee, 0.85);
    const hemi = new THREE.HemisphereLight(0xfefcf6, 0xcfc6b2, 0.55);
    const sun = new THREE.DirectionalLight(0xfff6e5, 1.3);
    sun.position.set(7, 13, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 32;
    sun.shadow.camera.left = -10;
    sun.shadow.camera.right = 10;
    sun.shadow.camera.top = 7;
    sun.shadow.camera.bottom = -7;
    sun.shadow.bias = -0.0008;
    scene.add(ambient, hemi, sun);

    const deskLampLight = new THREE.PointLight(0xffcf6e, 0.85, 5.5);
    deskLampLight.position.set(1.2, 2.05, -0.65);
    scene.add(deskLampLight);

    const githubGlowLight = new THREE.PointLight(COL.mintBright, 0, 4.5);
    githubGlowLight.position.set(-1.8, 1.6, -0.5);
    scene.add(githubGlowLight);

    // 3. Diorama Floor & Notebook Grid
    const floorGroup = new THREE.Group();
    scene.add(floorGroup);

    const baseSlab = new THREE.Mesh(
      new THREE.BoxGeometry(14.8, 0.4, 7.2),
      new THREE.MeshStandardMaterial({ color: 0xebe6d8, roughness: 0.9 })
    );
    baseSlab.position.y = -0.2;
    baseSlab.receiveShadow = true;
    floorGroup.add(baseSlab);

    const rimSlab = new THREE.Mesh(
      new THREE.BoxGeometry(15.05, 0.2, 7.45),
      new THREE.MeshStandardMaterial({ color: COL.ink, roughness: 0.85 })
    );
    rimSlab.position.y = -0.35;
    floorGroup.add(rimSlab);

    const grid = new THREE.GridHelper(14, 28, 0xd8d1bf, 0xe3decb);
    grid.position.y = 0.005;
    grid.scale.set(1, 1, 0.48);
    floorGroup.add(grid);

    // Subtle floor dashed path between stations
    const pathMat = new THREE.MeshBasicMaterial({ color: COL.mint, transparent: true, opacity: 0.45 });
    for (let x = -4.5; x <= 4.8; x += 0.55) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.01, 0.08), pathMat);
      dash.position.set(x, 0.01, 0.55);
      floorGroup.add(dash);
    }

    // 4. Build the 4 Stations

    // --- Station 1: Inbox Drop Chute ---
    const inboxGroup = new THREE.Group();
    scene.add(inboxGroup);

    const trayPad = new THREE.Mesh(
      new THREE.BoxGeometry(1.55, 0.14, 1.55),
      new THREE.MeshStandardMaterial({ color: COL.paper, roughness: 0.6 })
    );
    trayPad.position.set(STATIONS.inbox.x, 0.07, STATIONS.inbox.z);
    trayPad.receiveShadow = true;
    trayPad.castShadow = true;
    inboxGroup.add(trayPad);

    const trayRim = new THREE.Mesh(
      new THREE.BoxGeometry(1.65, 0.08, 1.65),
      new THREE.MeshStandardMaterial({ color: COL.terracotta, roughness: 0.6 })
    );
    trayRim.position.set(STATIONS.inbox.x, 0.04, STATIONS.inbox.z);
    inboxGroup.add(trayRim);

    // Overhead Pneumatic Chute Pipe
    const chutePipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.44, 0.52, 2.2, 16),
      new THREE.MeshStandardMaterial({ color: COL.ink, roughness: 0.45, metalness: 0.2 })
    );
    chutePipe.position.set(STATIONS.inbox.x, 5.1, STATIONS.inbox.z);
    const chuteRingMat = new THREE.MeshStandardMaterial({
      color: COL.terracotta,
      emissive: COL.terracotta,
      emissiveIntensity: 0.15,
    });
    const chuteRing = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.06, 8, 24), chuteRingMat);
    chuteRing.rotation.x = Math.PI / 2;
    chuteRing.position.set(STATIONS.inbox.x, 4.02, STATIONS.inbox.z);
    inboxGroup.add(chutePipe, chuteRing);

    const inboxLabelAnchor = new THREE.Object3D();
    inboxLabelAnchor.position.set(STATIONS.inbox.x, 0.15, STATIONS.inbox.z + 1.05);
    scene.add(inboxLabelAnchor);

    // --- Station 2: GitHub Terminal / Cloud Gate ---
    const githubGroup = new THREE.Group();
    scene.add(githubGroup);

    const ghBase = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 0.18, 2.2),
      new THREE.MeshStandardMaterial({ color: 0xd9d4c5, roughness: 0.8 })
    );
    ghBase.position.set(STATIONS.githubSlot.x, 0.09, -0.35);
    ghBase.receiveShadow = true;
    githubGroup.add(ghBase);

    const ghTower = new THREE.Mesh(
      new THREE.BoxGeometry(1.45, 1.95, 0.9),
      new THREE.MeshStandardMaterial({ color: COL.ink, roughness: 0.45 })
    );
    ghTower.position.set(STATIONS.githubSlot.x, 1.05, -0.95);
    ghTower.castShadow = true;
    ghTower.receiveShadow = true;
    githubGroup.add(ghTower);

    // Screen + LED bars
    const ghScreenMat = new THREE.MeshStandardMaterial({
      color: 0x1e3b31,
      emissive: COL.mintBright,
      emissiveIntensity: 0.25,
    });
    const ghScreen = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.6, 0.06), ghScreenMat);
    ghScreen.position.set(STATIONS.githubSlot.x, 1.48, -0.49);
    githubGroup.add(ghScreen);

    // Antenna + Pulse sphere
    const antennaPole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.05, 0.75, 8),
      new THREE.MeshStandardMaterial({ color: COL.mint })
    );
    antennaPole.position.set(STATIONS.githubSlot.x + 0.4, 2.38, -0.95);
    const antennaBulbMat = new THREE.MeshStandardMaterial({
      color: COL.mintBright,
      emissive: COL.mintBright,
      emissiveIntensity: 0.3,
    });
    const antennaBulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 12), antennaBulbMat);
    antennaBulb.position.set(STATIONS.githubSlot.x + 0.4, 2.8, -0.95);
    githubGroup.add(antennaPole, antennaBulb);

    // Conveyor Deposit Pad
    const conveyor = new THREE.Mesh(
      new THREE.BoxGeometry(0.85, 0.24, 1.1),
      new THREE.MeshStandardMaterial({ color: 0x384b40, roughness: 0.6 })
    );
    conveyor.position.set(STATIONS.githubDrop.x, 0.22, 0.05);
    conveyor.castShadow = true;
    githubGroup.add(conveyor);

    const githubLabelAnchor = new THREE.Object3D();
    githubLabelAnchor.position.set(STATIONS.githubSlot.x, 2.6, -0.4);
    scene.add(githubLabelAnchor);

    const githubBubbleAnchor = new THREE.Object3D();
    githubBubbleAnchor.position.set(STATIONS.githubSlot.x, 3.05, -0.7);
    scene.add(githubBubbleAnchor);

    // --- Station 3: Reading Desk ---
    const deskGroup = new THREE.Group();
    scene.add(deskGroup);

    const deskTop = new THREE.Mesh(
      new THREE.BoxGeometry(2.3, 0.14, 1.35),
      new THREE.MeshStandardMaterial({ color: COL.woodWarm, roughness: 0.65 })
    );
    deskTop.position.set(STATIONS.deskCenter.x, 0.92, STATIONS.deskCenter.z);
    deskTop.castShadow = true;
    deskTop.receiveShadow = true;
    deskGroup.add(deskTop);

    // Desk legs
    const legGeo = new THREE.BoxGeometry(0.14, 0.88, 0.14);
    const legMat = new THREE.MeshStandardMaterial({ color: COL.woodDark, roughness: 0.7 });
    [
      [-1.0, -0.54],
      [1.0, -0.54],
      [-1.0, 0.54],
      [1.0, 0.54],
    ].forEach(([dx, dz]) => {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(STATIONS.deskCenter.x + dx, 0.44, STATIONS.deskCenter.z + dz);
      leg.castShadow = true;
      deskGroup.add(leg);
    });

    // Desk blotter mat
    const blotter = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.02, 0.85),
      new THREE.MeshStandardMaterial({ color: COL.ink, roughness: 0.8 })
    );
    blotter.position.set(STATIONS.deskCenter.x, 1.0, STATIONS.deskCenter.z + 0.08);
    blotter.receiveShadow = true;
    deskGroup.add(blotter);

    // Vintage Banker Lamp
    const lampBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.2, 0.08, 12),
      new THREE.MeshStandardMaterial({ color: COL.brass, metalness: 0.4, roughness: 0.35 })
    );
    lampBase.position.set(STATIONS.deskCenter.x - 0.82, 1.03, STATIONS.deskCenter.z - 0.38);
    const lampStem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.65, 8),
      new THREE.MeshStandardMaterial({ color: COL.brass, metalness: 0.4, roughness: 0.35 })
    );
    lampStem.position.set(STATIONS.deskCenter.x - 0.82, 1.38, STATIONS.deskCenter.z - 0.38);
    const lampShade = new THREE.Mesh(
      new THREE.ConeGeometry(0.24, 0.22, 12),
      new THREE.MeshStandardMaterial({
        color: COL.mint,
        emissive: COL.brass,
        emissiveIntensity: 0.25,
      })
    );
    lampShade.position.set(STATIONS.deskCenter.x - 0.72, 1.72, STATIONS.deskCenter.z - 0.32);
    lampShade.rotation.z = -0.35;
    deskGroup.add(lampBase, lampStem, lampShade);

    // Holographic Scan Ring (visible during AI processing)
    const scanRingMat = new THREE.MeshBasicMaterial({
      color: COL.mintBright,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
    const scanRing = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.025, 8, 28), scanRingMat);
    scanRing.rotation.x = Math.PI / 2;
    scanRing.position.set(STATIONS.deskCenter.x, 1.3, STATIONS.deskCenter.z);
    scanRing.visible = false;
    scene.add(scanRing);

    // Orbiting Tag Motes (3 floating colorful cubes during AI processing)
    const tagMotesGroup = new THREE.Group();
    tagMotesGroup.position.set(STATIONS.deskCenter.x, 1.55, STATIONS.deskCenter.z);
    tagMotesGroup.visible = false;
    [COL.terracotta, COL.mintBright, COL.brass].forEach((c, idx) => {
      const mote = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.08, 0),
        new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.45 })
      );
      const ang = (idx * Math.PI * 2) / 3;
      mote.position.set(Math.cos(ang) * 0.62, 0, Math.sin(ang) * 0.62);
      tagMotesGroup.add(mote);
    });
    scene.add(tagMotesGroup);

    const deskLabelAnchor = new THREE.Object3D();
    deskLabelAnchor.position.set(STATIONS.deskCenter.x, 0.15, STATIONS.deskCenter.z + 1.05);
    scene.add(deskLabelAnchor);

    // --- Station 4: Filing Bookshelf & Manifest Ledger ---
    const shelfGroup = new THREE.Group();
    const shelfX = 5.45;
    const shelfZ = -0.75;
    scene.add(shelfGroup);

    const backBoard = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 2.6, 0.12),
      new THREE.MeshStandardMaterial({ color: COL.woodDark, roughness: 0.75 })
    );
    backBoard.position.set(shelfX, 1.3, shelfZ - 0.3);
    backBoard.castShadow = true;
    backBoard.receiveShadow = true;
    shelfGroup.add(backBoard);

    const sideL = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 2.6, 0.65),
      new THREE.MeshStandardMaterial({ color: COL.woodWarm, roughness: 0.7 })
    );
    sideL.position.set(shelfX - 0.9, 1.3, shelfZ);
    sideL.castShadow = true;
    const sideR = sideL.clone();
    sideR.position.set(shelfX + 0.9, 1.3, shelfZ);
    shelfGroup.add(sideL, sideR);

    [0.18, 0.95, 1.72, 2.52].forEach((py) => {
      const plank = new THREE.Mesh(
        new THREE.BoxGeometry(1.92, 0.1, 0.66),
        new THREE.MeshStandardMaterial({ color: COL.woodWarm, roughness: 0.7 })
      );
      plank.position.set(shelfX, py, shelfZ);
      plank.castShadow = true;
      plank.receiveShadow = true;
      shelfGroup.add(plank);
    });

    // Pre-existing decorative books on bottom shelf
    const decoColors = [COL.terracotta, COL.mint, COL.ink, 0x8b6f4e, COL.mintBright];
    decoColors.forEach((c, i) => {
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.48 + (i % 2) * 0.08, 0.42),
        new THREE.MeshStandardMaterial({ color: c, roughness: 0.65 })
      );
      b.position.set(shelfX - 0.65 + i * 0.18, 0.48, shelfZ + 0.02);
      b.castShadow = true;
      shelfGroup.add(b);
    });

    // Manifest Ledger podium
    const podium = new THREE.Mesh(
      new THREE.BoxGeometry(0.75, 0.9, 0.65),
      new THREE.MeshStandardMaterial({ color: COL.woodDark, roughness: 0.75 })
    );
    podium.position.set(5.35, 0.45, 1.45);
    podium.castShadow = true;
    const ledger = new THREE.Mesh(
      new THREE.BoxGeometry(0.56, 0.08, 0.44),
      new THREE.MeshStandardMaterial({ color: COL.paper, roughness: 0.5 })
    );
    ledger.position.set(5.35, 0.94, 1.45);
    ledger.rotation.x = 0.2;
    shelfGroup.add(podium, ledger);

    // Stamp celebration ring
    const stampRingMat = new THREE.MeshBasicMaterial({
      color: COL.terracotta,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
    });
    const stampRing = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.35, 24), stampRingMat);
    stampRing.rotation.x = -Math.PI / 2;
    stampRing.position.set(5.35, 1.0, 1.45);
    scene.add(stampRing);

    const shelfLabelAnchor = new THREE.Object3D();
    shelfLabelAnchor.position.set(shelfX, 0.15, shelfZ + 0.95);
    scene.add(shelfLabelAnchor);

    // 5. Build the 3 Agents
    const courier = createCharacter('courier', new THREE.Vector3(-4.0, 0, 1.75), 0.3);
    const archivist = createCharacter('archivist', new THREE.Vector3(1.55, 0, 1.75), 0);
    const librarian = createCharacter('librarian', new THREE.Vector3(4.5, 0, 2.05), -0.4);
    scene.add(courier.root, archivist.root, librarian.root);

    // 6. Dynamic Prop Meshes (Package & Bound Book)
    const pkg = createPackageMesh();
    pkg.root.visible = false;
    scene.add(pkg.root);

    const activeBook = createBookMesh(COL.terracotta);
    activeBook.visible = false;
    scene.add(activeBook);

    // 7. Helper: Move & Animate Characters
    const moveAgent = (
      agent: CharacterRig,
      tx: number,
      tz: number,
      moveSpeed: number,
      dt: number
    ): boolean => {
      const dx = tx - agent.root.position.x;
      const dz = tz - agent.root.position.z;
      const dist = Math.hypot(dx, dz);

      if (dist < 0.06) {
        agent.root.position.x = tx;
        agent.root.position.z = tz;
        return true;
      }

      const step = Math.min(dist, moveSpeed * dt);
      agent.root.position.x += (dx / dist) * step;
      agent.root.position.z += (dz / dist) * step;

      const targetYaw = Math.atan2(dx, dz);
      agent.root.rotation.y = lerpAngle(agent.root.rotation.y, targetYaw, Math.min(1, dt * 12));

      agent.walkPhase += dt * 11;
      const swing = Math.sin(agent.walkPhase) * 0.62;
      agent.leftLeg.rotation.x = swing;
      agent.rightLeg.rotation.x = -swing;
      agent.body.position.y = Math.abs(Math.cos(agent.walkPhase)) * 0.055;

      if (agent.carrying) {
        agent.leftArm.rotation.x = -1.15;
        agent.rightArm.rotation.x = -1.15;
      } else {
        agent.leftArm.rotation.x = -swing * 0.75;
        agent.rightArm.rotation.x = swing * 0.75;
      }
      return false;
    };

    const relaxAgent = (agent: CharacterRig, dt: number, idleTime: number, lookAtYaw?: number) => {
      const yaw = lookAtYaw !== undefined ? lookAtYaw : agent.homeRotY;
      agent.root.rotation.y = lerpAngle(agent.root.rotation.y, yaw, Math.min(1, dt * 8));
      agent.leftLeg.rotation.x *= 1 - Math.min(1, dt * 10);
      agent.rightLeg.rotation.x *= 1 - Math.min(1, dt * 10);
      if (agent.carrying) {
        agent.leftArm.rotation.x = -1.15;
        agent.rightArm.rotation.x = -1.15;
      } else {
        agent.leftArm.rotation.x *= 1 - Math.min(1, dt * 10);
        agent.rightArm.rotation.x *= 1 - Math.min(1, dt * 10);
      }
      agent.body.position.y = Math.sin(idleTime * 2.2) * 0.015;
    };

    const attachToAgent = (obj: THREE.Object3D, agent: CharacterRig) => {
      agent.carryAnchor.add(obj);
      obj.position.set(0, -0.08, 0);
      obj.rotation.set(0, 0, 0);
      agent.carrying = true;
    };

    const detachToScene = (obj: THREE.Object3D, worldPos: THREE.Vector3, agent?: CharacterRig) => {
      scene.add(obj);
      obj.position.copy(worldPos);
      obj.rotation.set(0, 0, 0);
      if (agent) agent.carrying = false;
    };

    const resetPropsAndActors = () => {
      pkg.root.visible = false;
      pkg.leftFlap.rotation.z = 0;
      pkg.rightFlap.rotation.z = 0;
      pkg.paper.visible = false;
      activeBook.visible = false;
      scanRing.visible = false;
      tagMotesGroup.visible = false;
      courier.carrying = false;
      archivist.carrying = false;
      librarian.carrying = false;
      scene.add(pkg.root, activeBook);
    };

    // 8. Projection Helper for Floating Bubbles & Labels
    const projVec = new THREE.Vector3();
    const projectEl = (
      anchor: THREE.Object3D,
      el: HTMLDivElement | null,
      w: number,
      h: number,
      offsetY = 0
    ) => {
      if (!el) return;
      anchor.getWorldPosition(projVec);
      projVec.project(camera);
      if (projVec.z > 1) {
        el.style.opacity = '0';
        return;
      }
      const x = (projVec.x * 0.5 + 0.5) * w;
      const y = (-projVec.y * 0.5 + 0.5) * h + offsetY;
      el.style.opacity = '1';
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
    };

    // 9. Resize Observer
    const updateSize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w <= 0 || h <= 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(updateSize);
    ro.observe(container);

    // 10. Main 60fps Animation Loop
    let animId = 0;
    let lastTime = performance.now();
    let globalTime = 0;

    const animate = (now: number) => {
      animId = requestAnimationFrame(animate);
      const rawDt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const sim = simRef.current;
      const dt = rawDt * sim.speed;
      globalTime += rawDt;

      if (sim.resetSceneRequested) {
        sim.resetSceneRequested = false;
        resetPropsAndActors();
      }

      // Smooth camera preset transition
      if (sim.cameraTargetPos && sim.cameraTargetLook) {
        camera.position.lerp(sim.cameraTargetPos, Math.min(1, rawDt * 5));
        controls.target.lerp(sim.cameraTargetLook, Math.min(1, rawDt * 5));
        if (camera.position.distanceTo(sim.cameraTargetPos) < 0.05) {
          sim.cameraTargetPos = null;
          sim.cameraTargetLook = null;
        }
      }

      // Start next queued job when idle
      if (sim.phase === 'idle' && sim.queue.length > 0) {
        const nextJob = sim.queue.shift()!;
        sim.currentJob = nextJob;
        sim.phase = 'dropping';
        sim.elapsed = 0;
        sim.pkgVelY = 0;
        sim.pkgBounced = false;

        resetPropsAndActors();
        pkg.root.visible = true;
        pkg.root.position.set(STATIONS.inbox.x, 4.6, STATIONS.inbox.z);
        setBubbleSafe.current({ courier: `Incoming: ${nextJob.filename}` });
      }

      const job = sim.currentJob;
      sim.elapsed += dt;

      // Reset dynamic lights gently
      githubGlowLight.intensity *= 1 - Math.min(1, rawDt * 4);
      ghScreenMat.emissiveIntensity = 0.25;
      antennaBulbMat.emissiveIntensity = 0.3;
      deskLampLight.intensity += (0.85 - deskLampLight.intensity) * Math.min(1, rawDt * 4);
      chuteRingMat.emissiveIntensity = 0.15;
      stampRingMat.opacity = Math.max(0, stampRingMat.opacity - rawDt * 1.4);
      stampRing.scale.setScalar(1 + (1 - stampRingMat.opacity) * 0.8);

      // --- STATE MACHINE ---
      if (sim.phase === 'idle') {
        // Check if Live GitHub Actions is running without an active replay job
        if (sim.liveStage && sim.liveStage !== 'idle') {
          if (sim.liveStage === 'github') {
            pkg.root.visible = true;
            pkg.root.position.set(STATIONS.githubDrop.x, 0.34, 0.05);
            githubGlowLight.intensity = 1.6 + Math.sin(globalTime * 6) * 0.5;
            antennaBulbMat.emissiveIntensity = 1.2;
            moveAgent(courier, STATIONS.githubDrop.x - 0.85, 0.45, 3.2, dt);
            relaxAgent(archivist, dt, globalTime);
            relaxAgent(librarian, dt, globalTime);
            setBubbleSafe.current({ github: 'Syncing with GitHub…' });
          } else if (sim.liveStage === 'ai') {
            pkg.root.visible = true;
            pkg.root.position.set(STATIONS.deskCenter.x, 1.0, STATIONS.deskCenter.z);
            pkg.leftFlap.rotation.z = 2.1;
            pkg.rightFlap.rotation.z = -2.1;
            pkg.paper.visible = true;
            pkg.paper.position.y = 0.52 + Math.sin(globalTime * 3.5) * 0.08;
            pkg.paper.rotation.y = globalTime * 1.1;
            scanRing.visible = true;
            scanRing.position.y = 1.45 + Math.sin(globalTime * 4) * 0.22;
            tagMotesGroup.visible = true;
            tagMotesGroup.rotation.y = globalTime * 2.2;
            deskLampLight.intensity = 1.9;
            if (moveAgent(archivist, STATIONS.deskLeft.x, STATIONS.deskLeft.z, 3.4, dt)) {
              relaxAgent(archivist, dt, globalTime, Math.PI * 0.9);
            }
            relaxAgent(courier, dt, globalTime);
            relaxAgent(librarian, dt, globalTime);
            setBubbleSafe.current({ archivist: 'Gemini is reading & tagging…' });
          } else if (sim.liveStage === 'deploy') {
            activeBook.visible = true;
            activeBook.position.set(5.35, 1.02, 1.45);
            stampRingMat.opacity = 0.5 + Math.sin(globalTime * 5) * 0.3;
            if (moveAgent(librarian, STATIONS.ledgerStand.x, STATIONS.ledgerStand.z, 3.4, dt)) {
              relaxAgent(librarian, dt, globalTime, 0.9);
            }
            relaxAgent(courier, dt, globalTime);
            relaxAgent(archivist, dt, globalTime);
            setBubbleSafe.current({ librarian: 'Publishing & deploying…' });
          }
        } else {
          // Relax everyone back home
          [courier, archivist, librarian].forEach((ag) => {
            if (moveAgent(ag, ag.homePos.x, ag.homePos.z, 3.0, dt)) {
              relaxAgent(ag, dt, globalTime);
            }
          });
        }
      } else if (sim.phase === 'dropping' && job) {
        chuteRingMat.emissiveIntensity = 1.2;
        sim.pkgVelY -= 16 * dt;
        pkg.root.position.y += sim.pkgVelY * dt;
        if (pkg.root.position.y <= 0.14) {
          pkg.root.position.y = 0.14;
          if (!sim.pkgBounced && Math.abs(sim.pkgVelY) > 1.8) {
            sim.pkgVelY = Math.abs(sim.pkgVelY) * 0.34;
            sim.pkgBounced = true;
          } else {
            sim.pkgVelY = 0;
          }
        }
        if (sim.elapsed > 0.95) {
          sim.phase = 'courier_to_inbox';
          sim.elapsed = 0;
          setBubbleSafe.current({ courier: `Picking up ${job.filename}` });
        }
      } else if (sim.phase === 'courier_to_inbox' && job) {
        const arrived = moveAgent(courier, STATIONS.inboxPickup.x, STATIONS.inboxPickup.z, 3.8, dt);
        if (arrived) {
          attachToAgent(pkg.root, courier);
          sim.phase = 'courier_to_github';
          sim.elapsed = 0;
          setBubbleSafe.current({ courier: 'Delivering → GitHub' });
        }
      } else if (sim.phase === 'courier_to_github' && job) {
        const arrived = moveAgent(courier, STATIONS.githubDrop.x - 0.15, 0.72, 3.6, dt);
        if (arrived) {
          detachToScene(
            pkg.root,
            new THREE.Vector3(STATIONS.githubDrop.x, 0.34, 0.25),
            courier
          );
          sim.phase = 'github_sync';
          sim.elapsed = 0;
          setBubbleSafe.current({ github: 'Committing to inbox/…' });
        }
      } else if (sim.phase === 'github_sync' && job) {
        // Courier walks back home while GitHub terminal ingests & outputs package
        if (moveAgent(courier, courier.homePos.x, courier.homePos.z, 3.2, dt)) {
          relaxAgent(courier, dt, globalTime);
        }
        githubGlowLight.intensity = 2.0 + Math.sin(globalTime * 14) * 0.6;
        ghScreenMat.emissiveIntensity = 1.1;
        antennaBulbMat.emissiveIntensity = 1.6;

        // Slide package slightly into terminal then pop onto pickup pad
        if (sim.elapsed < 0.6) {
          pkg.root.position.z = 0.25 - sim.elapsed * 0.9;
        } else {
          pkg.root.position.set(STATIONS.githubOut.x, 0.12, STATIONS.githubOut.z);
        }

        if (sim.elapsed > 1.2) {
          sim.phase = 'gemini_to_github';
          sim.elapsed = 0;
          setBubbleSafe.current({ archivist: 'Fetching from GitHub…' });
        }
      } else if (sim.phase === 'gemini_to_github' && job) {
        if (moveAgent(courier, courier.homePos.x, courier.homePos.z, 3.0, dt)) {
          relaxAgent(courier, dt, globalTime);
        }
        const arrived = moveAgent(
          archivist,
          STATIONS.githubOut.x + 0.55,
          STATIONS.githubOut.z + 0.35,
          3.9,
          dt
        );
        if (arrived) {
          attachToAgent(pkg.root, archivist);
          sim.phase = 'gemini_to_desk';
          sim.elapsed = 0;
          setBubbleSafe.current({ archivist: 'Taking to Reading Desk' });
        }
      } else if (sim.phase === 'gemini_to_desk' && job) {
        const arrived = moveAgent(archivist, STATIONS.deskLeft.x, STATIONS.deskLeft.z, 3.8, dt);
        if (arrived) {
          detachToScene(
            pkg.root,
            new THREE.Vector3(STATIONS.deskCenter.x, 1.0, STATIONS.deskCenter.z),
            archivist
          );
          sim.phase = 'ai_processing';
          sim.elapsed = 0;
          setBubbleSafe.current({ archivist: `Reading ${job.filename}…` });
        }
      } else if (sim.phase === 'ai_processing' && job) {
        relaxAgent(archivist, dt, globalTime, Math.PI * 0.92);
        archivist.head.rotation.y = Math.sin(globalTime * 4) * 0.16;
        archivist.rightArm.rotation.x = -0.6 + Math.sin(globalTime * 7) * 0.15;

        // Box flaps swing open + floating document + laser scan + tag motes
        const openProgress = Math.min(1, sim.elapsed / 0.45);
        pkg.leftFlap.rotation.z = openProgress * 2.15;
        pkg.rightFlap.rotation.z = -openProgress * 2.15;

        pkg.paper.visible = true;
        pkg.paper.position.y = 0.42 + openProgress * 0.22 + Math.sin(globalTime * 4) * 0.06;
        pkg.paper.rotation.y = globalTime * 1.4;

        scanRing.visible = true;
        scanRing.position.y = 1.48 + Math.sin(globalTime * 5) * 0.24;

        tagMotesGroup.visible = true;
        tagMotesGroup.rotation.y = globalTime * 2.8;
        deskLampLight.intensity = 2.0;

        if (sim.elapsed > 1.25) {
          const tagHint = job.tags.length ? ` #${job.tags[0]}` : '';
          setBubbleSafe.current({ archivist: `→ ${job.folder}${tagHint}` });
        }

        if (sim.elapsed > 2.65) {
          pkg.root.visible = false;
          pkg.paper.visible = false;
          scanRing.visible = false;
          tagMotesGroup.visible = false;

          activeBook.visible = true;
          activeBook.position.set(STATIONS.deskCenter.x + 0.65, 1.0, STATIONS.deskCenter.z + 0.1);

          sim.phase = 'librarian_to_desk';
          sim.elapsed = 0;
          setBubbleSafe.current({ librarian: `Collecting "${job.title}"` });
        }
      } else if (sim.phase === 'librarian_to_desk' && job) {
        archivist.head.rotation.y = 0;
        const arrived = moveAgent(librarian, STATIONS.deskRight.x, STATIONS.deskRight.z, 3.8, dt);
        if (arrived) {
          attachToAgent(activeBook, librarian);
          sim.phase = 'librarian_to_shelf';
          sim.elapsed = 0;
          setBubbleSafe.current({ librarian: `Filing → ${job.folder}` });
        }
      } else if (sim.phase === 'librarian_to_shelf' && job) {
        if (moveAgent(archivist, archivist.homePos.x, archivist.homePos.z, 3.0, dt)) {
          relaxAgent(archivist, dt, globalTime);
        }
        const arrived = moveAgent(librarian, STATIONS.shelfStand.x, STATIONS.shelfStand.z, 3.8, dt);
        if (arrived) {
          detachToScene(activeBook, new THREE.Vector3(5.45, 1.05, -0.75), librarian);
          activeBook.visible = false;

          // Permanently place a mini book on the bookshelf (up to 10 slots)
          const slot = sim.shelvedCount % 10;
          sim.shelvedCount += 1;
          const row = slot < 5 ? 0 : 1;
          const col = slot % 5;
          const bookColor = [COL.terracotta, COL.mint, COL.ink, COL.mintBright, COL.brass][
            slot % 5
          ];

          const placed = new THREE.Mesh(
            new THREE.BoxGeometry(0.15, 0.5, 0.42),
            new THREE.MeshStandardMaterial({ color: bookColor, roughness: 0.6 })
          );
          placed.position.set(5.45 - 0.62 + col * 0.28, row === 0 ? 1.25 : 2.02, -0.73);
          placed.castShadow = true;
          const bookWrap = new THREE.Group();
          bookWrap.add(placed);
          scene.add(bookWrap);
          sim.shelfBooks.push(bookWrap);
          if (sim.shelfBooks.length > 10) {
            const oldest = sim.shelfBooks.shift()!;
            scene.remove(oldest);
          }

          sim.phase = 'shelving_and_stamp';
          sim.elapsed = 0;
          setBubbleSafe.current({ librarian: 'Indexed in manifest ✓' });
        }
      } else if (sim.phase === 'shelving_and_stamp' && job) {
        const arrived = moveAgent(librarian, STATIONS.ledgerStand.x, STATIONS.ledgerStand.z, 3.5, dt);
        if (arrived) {
          relaxAgent(librarian, dt, globalTime, 0.85);
          librarian.rightArm.rotation.x = -0.8 + Math.sin(sim.elapsed * 12) * 0.35;
          if (sim.elapsed < 0.7) {
            stampRingMat.opacity = 0.85;
          }
        }
        if (sim.elapsed > 1.15) {
          sim.phase = 'return_idle';
          sim.elapsed = 0;
          setBubbleSafe.current({ librarian: 'Saved & ready!' });
        }
      } else if (sim.phase === 'return_idle') {
        const back = moveAgent(librarian, librarian.homePos.x, librarian.homePos.z, 3.4, dt);
        if (back || sim.elapsed > 0.7) {
          sim.phase = 'idle';
          sim.currentJob = null;
          sim.elapsed = 0;
          if (sim.queue.length === 0) {
            setTimeout(() => {
              if (simRef.current.phase === 'idle' && simRef.current.queue.length === 0) {
                setBubbleSafe.current({});
              }
            }, 1400);
          }
        }
      }

      // Notify parent when phase or active job changes
      const jobId = sim.currentJob?.id || '';
      if (sim.lastNotifiedPhase !== sim.phase || sim.lastNotifiedJobId !== jobId) {
        sim.lastNotifiedPhase = sim.phase;
        sim.lastNotifiedJobId = jobId;
        onStateChange?.({
          phase: sim.phase,
          currentJob: sim.currentJob,
          queueCount: sim.queue.length,
        });
      }

      controls.update();
      renderer.render(scene, camera);

      // Update floating HTML labels & speech bubbles in sync with 3D camera
      const w = container.clientWidth;
      const h = container.clientHeight;
      projectEl(courier.headAnchor, courierBubbleEl.current, w, h, -6);
      projectEl(archivist.headAnchor, archivistBubbleEl.current, w, h, -6);
      projectEl(librarian.headAnchor, librarianBubbleEl.current, w, h, -6);
      projectEl(githubBubbleAnchor, githubBubbleEl.current, w, h, -6);

      projectEl(inboxLabelAnchor, stationEls.current.inbox, w, h, 14);
      projectEl(githubLabelAnchor, stationEls.current.github, w, h, -8);
      projectEl(deskLabelAnchor, stationEls.current.desk, w, h, 14);
      projectEl(shelfLabelAnchor, stationEls.current.shelf, w, h, 14);
    };

    animId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
      controls.removeEventListener('start', onControlStart);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [onStateChange]);

  return (
    <div
      ref={mountRef}
      className="relative w-full h-[360px] sm:h-[420px] rounded-xl overflow-hidden border border-rule bg-[#F4F0E4] select-none"
    >
      {/* 3D Station Labels */}
      <div
        ref={(el) => {
          stationEls.current.inbox = el;
        }}
        className="pointer-events-none absolute top-0 left-0 px-2 py-0.5 rounded-md bg-paper/90 border border-rule shadow-2xs font-mono text-[10px] text-ink whitespace-nowrap"
      >
        1. Inbox Chute
      </div>
      <div
        ref={(el) => {
          stationEls.current.github = el;
        }}
        className="pointer-events-none absolute top-0 left-0 px-2 py-0.5 rounded-md bg-ink/90 text-ivory shadow-2xs font-mono text-[10px] whitespace-nowrap"
      >
        2. GitHub Gate
      </div>
      <div
        ref={(el) => {
          stationEls.current.desk = el;
        }}
        className="pointer-events-none absolute top-0 left-0 px-2 py-0.5 rounded-md bg-paper/90 border border-rule shadow-2xs font-mono text-[10px] text-ink whitespace-nowrap"
      >
        3. Reading Desk
      </div>
      <div
        ref={(el) => {
          stationEls.current.shelf = el;
        }}
        className="pointer-events-none absolute top-0 left-0 px-2 py-0.5 rounded-md bg-paper/90 border border-rule shadow-2xs font-mono text-[10px] text-ink whitespace-nowrap"
      >
        4. Archive Shelf
      </div>

      {/* Projected 3D Agent Speech Bubbles */}
      <div
        ref={courierBubbleEl}
        className={`pointer-events-none absolute top-0 left-0 transition-opacity duration-150 ${
          bubbles.courier ? 'visible' : 'invisible'
        }`}
      >
        {bubbles.courier && (
          <div className="px-2.5 py-1 rounded-lg bg-paper border border-terracotta/50 shadow-sm text-[11px] font-mono text-ink whitespace-nowrap max-w-[210px] truncate">
            <span className="text-terracotta font-semibold">Courier:</span> {bubbles.courier}
          </div>
        )}
      </div>

      <div
        ref={archivistBubbleEl}
        className={`pointer-events-none absolute top-0 left-0 transition-opacity duration-150 ${
          bubbles.archivist ? 'visible' : 'invisible'
        }`}
      >
        {bubbles.archivist && (
          <div className="px-2.5 py-1 rounded-lg bg-paper border border-mint/60 shadow-sm text-[11px] font-mono text-ink whitespace-nowrap max-w-[230px] truncate">
            <span className="text-mint font-semibold">Gemini:</span> {bubbles.archivist}
          </div>
        )}
      </div>

      <div
        ref={librarianBubbleEl}
        className={`pointer-events-none absolute top-0 left-0 transition-opacity duration-150 ${
          bubbles.librarian ? 'visible' : 'invisible'
        }`}
      >
        {bubbles.librarian && (
          <div className="px-2.5 py-1 rounded-lg bg-paper border border-ink/40 shadow-sm text-[11px] font-mono text-ink whitespace-nowrap max-w-[220px] truncate">
            <span className="text-ink font-semibold">Librarian:</span> {bubbles.librarian}
          </div>
        )}
      </div>

      <div
        ref={githubBubbleEl}
        className={`pointer-events-none absolute top-0 left-0 transition-opacity duration-150 ${
          bubbles.github ? 'visible' : 'invisible'
        }`}
      >
        {bubbles.github && (
          <div className="px-2.5 py-1 rounded-lg bg-ink text-ivory border border-mint/40 shadow-sm text-[11px] font-mono whitespace-nowrap">
            {bubbles.github}
          </div>
        )}
      </div>

      {/* Subtle Orbit Hint */}
      <div className="pointer-events-none absolute bottom-2.5 right-3 px-2 py-0.5 rounded bg-paper/75 backdrop-blur-xs border border-rule/80 font-mono text-[10px] text-ink-muted">
        Drag to rotate • Scroll to zoom
      </div>
    </div>
  );
}