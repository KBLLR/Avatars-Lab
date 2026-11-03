import { loadPerformanceCatalog } from "../performance-engine/catalog";
import { PerformanceRoom } from "../performance-engine/room";
import type {
  ActorAsset,
  ActorRuntimeCapabilities,
  PerformanceActor,
  PerformanceCatalog,
  PerformanceEnvironment,
} from "../performance-engine/types";

const ACTOR_ID = "facial-portrait-actor";
const FACIAL_LAB: PerformanceEnvironment = {
  id: "room:facial-lab",
  label: "Facial Performance Lab",
  room: "facial-lab",
  exposure: 1.08,
  backgroundIntensity: 0.45,
  environmentIntensity: 0.82,
};

export interface FacialPortraitSnapshot {
  renderer: string;
  actorId: string;
  headId: string;
  headLabel: string;
  capabilities: ActorRuntimeCapabilities;
}

export class FacialPortraitRuntime {
  readonly actorId = ACTOR_ID;
  private currentHead: ActorAsset;

  private constructor(
    readonly room: PerformanceRoom,
    readonly catalog: PerformanceCatalog,
    head: ActorAsset,
    private capabilities: ActorRuntimeCapabilities,
  ) {
    this.currentHead = head;
  }

  static async create(container: HTMLElement, preferredHeadId = "head:kbllr"): Promise<FacialPortraitRuntime> {
    const [room, catalog] = await Promise.all([
      PerformanceRoom.create(container),
      loadPerformanceCatalog(),
    ]);
    const head = catalog.actors.find((asset) => asset.id === preferredHeadId) ||
      catalog.actors.find((asset) => asset.kind === "head");
    if (!head) {
      room.dispose();
      throw new Error("No Core-X head assets are available for facial performance.");
    }
    await room.setEnvironment(FACIAL_LAB);
    room.setLightingPreset("studio");
    const capabilities = await room.loadActor(FacialPortraitRuntime.actorDefinition(head));
    if (!capabilities) {
      room.dispose();
      throw new Error(`Head load was superseded before ${head.label} became ready.`);
    }
    FacialPortraitRuntime.frameForOperator(room);
    return new FacialPortraitRuntime(room, catalog, head, capabilities);
  }

  private static actorDefinition(asset: ActorAsset): PerformanceActor {
    return {
      id: ACTOR_ID,
      label: asset.label.replace(/ \/ Head$/, ""),
      asset,
      shader: "realismus",
      position: { x: 0, y: 0, z: 0 },
      rotationY: 0,
      scale: 1,
      visible: true,
    };
  }

  private static frameForOperator(room: PerformanceRoom): void {
    room.setCameraAuthority("director");
    room.setCameraCue({ preset: "portrait", targetActorId: ACTOR_ID, transitionMs: 0, lensMm: 72 });
    room.setCameraAuthority("operator");
  }

  headOptions(): ActorAsset[] {
    return this.catalog.actors.filter((asset) => asset.kind === "head");
  }

  async loadHead(assetId: string): Promise<FacialPortraitSnapshot> {
    const head = this.headOptions().find((asset) => asset.id === assetId);
    if (!head) throw new Error(`Unknown Core-X head: ${assetId}`);
    const capabilities = await this.room.loadActor(FacialPortraitRuntime.actorDefinition(head));
    if (!capabilities) throw new Error(`Head load was superseded: ${head.label}`);
    this.currentHead = head;
    this.capabilities = capabilities;
    FacialPortraitRuntime.frameForOperator(this.room);
    return this.snapshot();
  }

  setExpression(values: Record<string, number>): void {
    this.room.setExpression(ACTOR_ID, values);
  }

  resetExpression(): void {
    this.room.resetExpression(ACTOR_ID);
  }

  setHeadPose(pose: { pitch?: number; yaw?: number; roll?: number }): void {
    this.room.setHeadPose(ACTOR_ID, pose);
  }

  resetHeadPose(): void {
    this.room.resetHeadPose(ACTOR_ID);
  }

  snapshot(): FacialPortraitSnapshot {
    return {
      renderer: this.room.rendererLabel,
      actorId: ACTOR_ID,
      headId: this.currentHead.id,
      headLabel: this.currentHead.label.replace(/ \/ Head$/, ""),
      capabilities: this.capabilities,
    };
  }

  dispose(): void {
    this.room.dispose();
  }
}
