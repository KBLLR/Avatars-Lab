import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  Vector3,
} from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { color, mix, sin, time, uv } from "three/tsl";

export interface StageEffectCue {
  shader?: "clean" | "aurora" | "pulse" | "monochrome";
  particles?: "none" | "dust" | "sparks" | "rain" | "embers";
  physics?: "none" | "confetti";
  intensity?: number;
  palette?: string;
  pulseOnBeat?: boolean;
}

type Rapier = typeof import("@dimforge/rapier3d-compat");

let rapierInitialization: Promise<Rapier> | null = null;
const loadRapier = (): Promise<Rapier> => {
  if (!rapierInitialization) {
    rapierInitialization = import("@dimforge/rapier3d-compat")
      .then(async (rapier) => {
        await rapier.init();
        return rapier;
      })
      .catch((error) => {
        rapierInitialization = null;
        throw error;
      });
  }
  return rapierInitialization;
};

const palettes: Record<string, [string, string]> = {
  neon: ["#07111d", "#d946ef"],
  noir: ["#030303", "#6b7280"],
  sunset: ["#29120d", "#fb923c"],
  frost: ["#08131f", "#7dd3fc"],
  crimson: ["#170407", "#ef4444"],
};

const disposeGroup = (group: Group): void => {
  group.traverse((object) => {
    const renderable = object as Mesh;
    renderable.geometry?.dispose();
    const materials = renderable.material
      ? Array.isArray(renderable.material) ? renderable.material : [renderable.material]
      : [];
    for (const material of materials) material.dispose();
  });
  group.clear();
};

export class StageEffectsController {
  private root = new Group();
  private particles: Points | null = null;
  private particleVelocity: Float32Array | null = null;
  private particlePreset: StageEffectCue["particles"] = "none";
  private intensity = 0;
  private musicEnergy = 0;
  private pulseOnBeat = false;
  private backdrop: Mesh | null = null;
  private physicsRoot = new Group();
  private rapier: Rapier | null = null;
  private physicsWorld: InstanceType<Rapier["World"]> | null = null;
  private physicsBodies: Array<InstanceType<Rapier["RigidBody"]>> = [];
  private physicsMesh: InstancedMesh | null = null;
  private generation = 0;
  private matrix = new Matrix4();
  private position = new Vector3();
  private rotation = new Quaternion();
  private physicsFailureReported = false;

  constructor(private scene: Scene) {
    this.root.name = "AvatarLabsStageEffects";
    this.physicsRoot.name = "AvatarLabsStagePhysics";
    this.root.add(this.physicsRoot);
    this.scene.add(this.root);
  }

  async setCue(cue: StageEffectCue): Promise<void> {
    const generation = ++this.generation;
    this.intensity = Math.max(0, Math.min(1, Number(cue.intensity) || 0));
    this.pulseOnBeat = cue.pulseOnBeat === true;
    this.setBackdrop(cue.shader || "clean", cue.palette || "frost");
    this.setParticles(cue.particles || "none", cue.palette || "frost");
    if (cue.physics === "confetti") {
      try {
        await this.createConfetti(generation, cue.palette || "neon");
      } catch (error) {
        if (generation !== this.generation) return;
        this.clearPhysics();
        console.warn(
          "[Stage Effects] Rapier physics unavailable; keeping shader and particle effects without confetti.",
          error,
        );
      }
    } else {
      this.clearPhysics();
    }
  }

  setMusicEnergy(value: number): void {
    this.musicEnergy = Math.max(0, Math.min(1, value));
  }

  private setBackdrop(shader: NonNullable<StageEffectCue["shader"]>, palette: string): void {
    if (this.backdrop) {
      this.root.remove(this.backdrop);
      this.backdrop.geometry.dispose();
      const material = this.backdrop.material;
      for (const item of Array.isArray(material) ? material : [material]) item.dispose();
      this.backdrop = null;
    }
    if (shader === "clean") return;
    const [dark, accent] = palettes[palette] || palettes.frost;
    const material = new MeshBasicNodeMaterial();
    const coords = uv();
    const horizontal = sin(coords.x.mul(shader === "pulse" ? 14 : 4).add(time.mul(shader === "aurora" ? 0.35 : 1.2))).mul(0.5).add(0.5);
    const vertical = sin(coords.y.mul(7).sub(time.mul(0.22))).mul(0.5).add(0.5);
    const wave = horizontal.mul(0.65).add(vertical.mul(0.35));
    material.colorNode = shader === "monochrome"
      ? mix(color("#050505"), color("#9ca3af"), wave.mul(0.42))
      : mix(color(dark), color(accent), wave.mul(0.55));
    material.transparent = true;
    material.opacity = shader === "pulse" ? 0.78 : 0.68;
    const backdrop = new Mesh(new PlaneGeometry(18, 8), material);
    backdrop.position.set(0, 4, -4.12);
    backdrop.renderOrder = 1;
    this.backdrop = backdrop;
    this.root.add(backdrop);
  }

  private setParticles(preset: NonNullable<StageEffectCue["particles"]>, palette: string): void {
    if (this.particles) {
      this.root.remove(this.particles);
      this.particles.geometry.dispose();
      (this.particles.material as PointsMaterial).dispose();
      this.particles = null;
      this.particleVelocity = null;
    }
    this.particlePreset = preset;
    if (preset === "none") return;
    const count = 260;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const offset = index * 3;
      positions[offset] = (Math.random() - 0.5) * 12;
      positions[offset + 1] = Math.random() * 6;
      positions[offset + 2] = (Math.random() - 0.5) * 6 - 0.5;
      velocities[offset] = (Math.random() - 0.5) * 0.3;
      velocities[offset + 1] = preset === "rain" ? -(1.8 + Math.random() * 2.4) : 0.18 + Math.random() * 0.8;
      velocities[offset + 2] = (Math.random() - 0.5) * 0.22;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3).setUsage(DynamicDrawUsage));
    const [, accent] = palettes[palette] || palettes.frost;
    const material = new PointsMaterial({
      color: new Color(preset === "rain" ? "#9bd8ff" : accent),
      size: preset === "dust" ? 0.025 : preset === "rain" ? 0.035 : 0.055,
      transparent: true,
      opacity: preset === "dust" ? 0.38 : 0.72,
      depthWrite: false,
    });
    this.particleVelocity = velocities;
    this.particles = new Points(geometry, material);
    this.particles.renderOrder = 3;
    this.root.add(this.particles);
  }

  private async createConfetti(generation: number, palette: string): Promise<void> {
    this.clearPhysics();
    const rapier = await loadRapier();
    if (generation !== this.generation) return;
    this.rapier = rapier;
    const world = new rapier.World({ x: 0, y: -7.5, z: 0 });
    const floor = world.createRigidBody(rapier.RigidBodyDesc.fixed().setTranslation(0, -0.08, 0));
    world.createCollider(rapier.ColliderDesc.cuboid(9, 0.08, 7), floor);
    const count = Math.round(22 + this.intensity * 42);
    const [dark, accent] = palettes[palette] || palettes.neon;
    const material = new MeshBasicMaterial({ color: new Color(accent), vertexColors: false });
    const mesh = new InstancedMesh(new BoxGeometry(0.07, 0.025, 0.12), material, count);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    for (let index = 0; index < count; index += 1) {
      const body = world.createRigidBody(
        rapier.RigidBodyDesc.dynamic()
          .setTranslation((Math.random() - 0.5) * 5.5, 3 + Math.random() * 3, (Math.random() - 0.5) * 2.4)
          .setLinvel((Math.random() - 0.5) * 2.8, 1.5 + Math.random() * 3.5, (Math.random() - 0.5) * 1.8)
          .setAngvel({ x: Math.random() * 8, y: Math.random() * 8, z: Math.random() * 8 }),
      );
      world.createCollider(rapier.ColliderDesc.cuboid(0.035, 0.0125, 0.06).setRestitution(0.42), body);
      this.physicsBodies.push(body);
      mesh.setColorAt(index, new Color(index % 3 === 0 ? dark : index % 3 === 1 ? accent : "#f5f5f4"));
    }
    this.physicsWorld = world;
    this.physicsMesh = mesh;
    this.physicsFailureReported = false;
    this.physicsRoot.add(mesh);
  }

  private clearPhysics(): void {
    disposeGroup(this.physicsRoot);
    this.physicsBodies = [];
    const world = this.physicsWorld;
    this.physicsWorld = null;
    this.physicsMesh = null;
    this.rapier = null;
    if (world) {
      try {
        world.free();
      } catch (error) {
        if (!this.physicsFailureReported) {
          this.physicsFailureReported = true;
          console.warn("[Stage Effects] Rapier world was already invalidated; physics state was discarded.", error);
        }
      }
    }
  }

  update(deltaMs: number): void {
    const delta = Math.min(0.05, deltaMs / 1000);
    if (this.particles && this.particleVelocity) {
      const attribute = this.particles.geometry.getAttribute("position") as BufferAttribute;
      const positions = attribute.array as Float32Array;
      const speed = 0.45 + this.intensity * 1.35 + (this.pulseOnBeat ? this.musicEnergy * 0.8 : 0);
      for (let offset = 0; offset < positions.length; offset += 3) {
        positions[offset] += this.particleVelocity[offset] * delta * speed;
        positions[offset + 1] += this.particleVelocity[offset + 1] * delta * speed;
        positions[offset + 2] += this.particleVelocity[offset + 2] * delta * speed;
        const escaped = this.particlePreset === "rain" ? positions[offset + 1] < 0 : positions[offset + 1] > 6.5;
        if (escaped) {
          positions[offset] = (Math.random() - 0.5) * 12;
          positions[offset + 1] = this.particlePreset === "rain" ? 6.5 : 0;
          positions[offset + 2] = (Math.random() - 0.5) * 6 - 0.5;
        }
      }
      attribute.needsUpdate = true;
      const material = this.particles.material as PointsMaterial;
      material.opacity = Math.min(0.9, 0.3 + this.intensity * 0.4 + this.musicEnergy * 0.18);
    }
    if (this.physicsWorld && this.physicsMesh) {
      try {
        this.physicsWorld.timestep = delta;
        this.physicsWorld.step();
        this.physicsBodies.forEach((body, index) => {
          const translation = body.translation();
          const rotation = body.rotation();
          this.position.set(translation.x, translation.y, translation.z);
          this.rotation.set(rotation.x, rotation.y, rotation.z, rotation.w);
          this.matrix.compose(this.position, this.rotation, new Vector3(1, 1, 1));
          this.physicsMesh!.setMatrixAt(index, this.matrix);
        });
        this.physicsMesh.instanceMatrix.needsUpdate = true;
      } catch (error) {
        if (!this.physicsFailureReported) {
          this.physicsFailureReported = true;
          console.warn("[Stage Effects] Rapier runtime failed; disabling confetti while preserving other stage effects.", error);
        }
        this.clearPhysics();
      }
    }
  }

  reset(): void {
    this.generation += 1;
    this.setBackdrop("clean", "frost");
    this.setParticles("none", "frost");
    this.clearPhysics();
    this.intensity = 0;
  }

  dispose(): void {
    this.reset();
    this.scene.remove(this.root);
    disposeGroup(this.root);
  }
}
