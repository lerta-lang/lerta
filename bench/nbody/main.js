// Simulates the Sun and the four giant planets for a number of steps, and prints their energy before
// and after, in billionths, rounded.
const SOLAR_MASS = 4.0 * Math.PI * Math.PI;
const DAYS_PER_YEAR = 365.24;
const STEPS = 10000000;

class Body {
  constructor(x, y, z, vx, vy, vz, mass) {
    Object.assign(this, { x, y, z, vx, vy, vz, mass });
  }
}

function planet(x, y, z, vx, vy, vz, mass) {
  return new Body(x, y, z, vx * DAYS_PER_YEAR, vy * DAYS_PER_YEAR, vz * DAYS_PER_YEAR,
    mass * SOLAR_MASS);
}

const bodies = [
  new Body(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, SOLAR_MASS),
  planet(4.84143144246472090e+00, -1.16032004402742839e+00, -1.03622044471123109e-01,
    1.66007664274403694e-03, 7.69901118419740425e-03, -6.90460016972063023e-05,
    9.54791938424326609e-04),
  planet(8.34336671824457987e+00, 4.12479856412430479e+00, -4.03523417114321381e-01,
    -2.76742510726862411e-03, 4.99852801234917238e-03, 2.30417297573763929e-05,
    2.85885980666130812e-04),
  planet(1.28943695621391310e+01, -1.51111514016986312e+01, -2.23307578892655734e-01,
    2.96460137564761618e-03, 2.37847173959480950e-03, -2.96589568540237556e-05,
    4.36624404335156298e-05),
  planet(1.53796971148509165e+01, -2.59193146099879641e+01, 1.79258772950371181e-01,
    2.68067772490389322e-03, 1.62824170038242295e-03, -9.51592254519715870e-05,
    5.15138902046611451e-05),
];

// Gives the Sun the momentum that makes the system's total zero.
function offsetMomentum() {
  let px = 0.0, py = 0.0, pz = 0.0;
  for (const body of bodies) {
    px += body.vx * body.mass;
    py += body.vy * body.mass;
    pz += body.vz * body.mass;
  }
  const sun = bodies[0];
  sun.vx = -px / SOLAR_MASS;
  sun.vy = -py / SOLAR_MASS;
  sun.vz = -pz / SOLAR_MASS;
}

function advance(dt) {
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
      const distanceSquared = dx * dx + dy * dy + dz * dz;
      const magnitude = dt / (distanceSquared * Math.sqrt(distanceSquared));
      a.vx -= dx * b.mass * magnitude;
      a.vy -= dy * b.mass * magnitude;
      a.vz -= dz * b.mass * magnitude;
      b.vx += dx * a.mass * magnitude;
      b.vy += dy * a.mass * magnitude;
      b.vz += dz * a.mass * magnitude;
    }
  }
  for (const body of bodies) {
    body.x += dt * body.vx;
    body.y += dt * body.vy;
    body.z += dt * body.vz;
  }
}

function energy() {
  let e = 0.0;
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    e += 0.5 * a.mass * (a.vx * a.vx + a.vy * a.vy + a.vz * a.vz);
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
      e -= a.mass * b.mass / Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
  }
  return e;
}

// Away from zero at a half, as the other languages round, which Math.round does not for negatives.
const inBillionths = (e) => Math.sign(e) * Math.round(Math.abs(e * 1e9));

offsetMomentum();
console.log(inBillionths(energy()));
for (let i = 0; i < STEPS; i++) advance(0.01);
console.log(inBillionths(energy()));
