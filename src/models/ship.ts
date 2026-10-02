// 戰船（赤壁連環船）：船身、樓艙、桅杆與帆；只當場景裝飾（燃燒中的曹軍船隊）
import * as THREE from 'three';
import { box, cyl, ModelBuilder, T } from './kit';

const C = {
  hull: '#5a3a20',
  hullDark: '#3a2414',
  deck: '#8a6a40',
  cabin: '#a87e4c',
  sail: '#d9c9a2',
  rope: '#c8b58a',
};

/** 船身沿 +Z（船頭），長約 16 m；回傳合併幾何（頂點色，隊伍色用 aMask＝1 標記） */
export function shipGeometry(team: THREE.ColorRepresentation, burnt = false): THREE.BufferGeometry {
  const mb = new ModelBuilder();
  const dim = (c: string) => (burnt ? new THREE.Color(c).multiplyScalar(0.35).getStyle() : c);
  const tc = burnt ? new THREE.Color(team).multiplyScalar(0.3).getStyle() : new THREE.Color(team).getStyle();
  // 船身：兩頭收窄、上翹
  const hull = new THREE.BoxGeometry(4.2, 1.8, 16, 1, 1, 10);
  const p = hull.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    const t = z / 8;
    const y = p.getY(i);
    const narrow = 1 - 0.62 * Math.pow(Math.abs(t), 3);
    p.setX(i, p.getX(i) * narrow * (y < 0 ? 0.78 : 1));
    p.setY(i, y + 1.1 * t * t + (y > 0 ? 0 : 0.2 * t * t));
  }
  hull.computeVertexNormals();
  mb.add(hull, dim(C.hull), 0, T(0, 0.6, 0));
  mb.add(box(3.6, 0.15, 13), dim(C.deck), 0, T(0, 1.5, 0));
  // 船舷欄杆
  for (const s of [-1, 1]) mb.add(box(0.12, 0.5, 12), dim(C.hullDark), 0, T(s * 1.85, 1.8, 0));
  // 樓艙兩層
  mb.add(box(3.0, 1.8, 5), dim(C.cabin), 0, T(0, 2.5, -1));
  mb.add(box(3.4, 0.25, 5.6), tc, 0, T(0, 3.5, -1), 1);
  mb.add(box(2.2, 1.4, 3), dim(C.cabin), 0, T(0, 4.3, -1.5));
  mb.add(box(2.6, 0.22, 3.6), tc, 0, T(0, 5.1, -1.5), 1);
  // 桅杆與帆
  mb.add(cyl(0.14, 0.18, 11, 6), dim(C.hullDark), 0, T(0, 6.8, 3));
  if (!burnt) {
    mb.add(box(5.2, 6.2, 0.12), C.sail, 0, T(0, 8, 3.1), 0);
    for (let k = 0; k < 5; k++) mb.add(box(5.3, 0.12, 0.16), C.hullDark, 0, T(0, 5.4 + k * 1.3, 3.15));
    mb.add(box(1.6, 1.0, 0.14), tc, 0, T(0, 12.2, 3), 1);
  } else {
    // 燒剩的帆布條
    mb.add(box(2.4, 2.2, 0.1), '#2a2018', 0, T(-0.8, 9.5, 3.1, 0, 0, 0.2));
  }
  // 船頭撞角
  mb.add(box(0.5, 0.5, 1.6), dim(C.hullDark), 0, T(0, 1.4, 8.6, -0.3));
  return mb.build();
}

/** 船上起火點（區域座標） */
export const SHIP_FIRE: THREE.Vector3[] = [new THREE.Vector3(0, 3.6, -1), new THREE.Vector3(0, 5.3, -1.5), new THREE.Vector3(0, 2, 5), new THREE.Vector3(0, 2, -5.5), new THREE.Vector3(0, 8, 3)];
