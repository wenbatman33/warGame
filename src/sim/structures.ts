// 糧倉、本陣、營寨、水源、輜重車（docs/03）
export type StructKind = 'depot' | 'hq' | 'camp' | 'water';

export class Structure {
  readonly id: number;
  readonly kind: StructKind;
  team: number;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  stock: number;
  maxStock: number;
  /** 火勢 0..1 */
  fire = 0;
  /** 點火進度 0..1 */
  ignite = 0;
  burnt = false;
  main: boolean;
  name: string;
  /** 最近一次被攻擊的時間 */
  attackedT = -99;
  wagonT = 0;
  /** 佔領進度（本陣） */
  capture = 0;
  /** 營門朝向（弧度，0＝+Z） */
  gate = 0;
  /** 原始擁有者（水源易主判斷用） */
  readonly owner: number;

  constructor(id: number, kind: StructKind, team: number, x: number, z: number, stock: number, main: boolean, name: string) {
    this.id = id;
    this.kind = kind;
    this.team = team;
    this.owner = team;
    this.x = x;
    this.z = z;
    this.stock = stock;
    this.maxStock = stock;
    this.main = main;
    this.name = name;
    this.radius = kind === 'hq' ? 24 : kind === 'camp' ? 12 : kind === 'water' ? 10 : main ? 22 : 15;
  }

  get frac(): number {
    return this.maxStock > 0 ? this.stock / this.maxStock : 0;
  }
}

export class Wagon {
  readonly id: number;
  readonly team: number;
  x: number;
  z: number;
  px: number;
  pz: number;
  yaw = 0;
  path: [number, number][];
  pathI = 0;
  load: number;
  hp = 600;
  alive = true;
  arrived = false;
  readonly from: number;

  constructor(id: number, team: number, from: number, x: number, z: number, path: [number, number][], load: number) {
    this.id = id;
    this.team = team;
    this.from = from;
    this.x = this.px = x;
    this.z = this.pz = z;
    this.path = path;
    this.load = load;
  }
}
