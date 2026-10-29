// Simulates the Sun and the four giant planets for a number of steps, and prints their energy before
// and after, in billionths, rounded.
let solarMass = 4.0 * Double.pi * Double.pi
let daysPerYear = 365.24
let steps = 10000000

final class Body {
  var x, y, z, vx, vy, vz, mass: Double

  init(_ x: Double, _ y: Double, _ z: Double, _ vx: Double, _ vy: Double, _ vz: Double,
       _ mass: Double) {
    (self.x, self.y, self.z, self.vx, self.vy, self.vz, self.mass) = (x, y, z, vx, vy, vz, mass)
  }
}

func planet(_ x: Double, _ y: Double, _ z: Double, _ vx: Double, _ vy: Double, _ vz: Double,
            _ mass: Double) -> Body {
  Body(x, y, z, vx * daysPerYear, vy * daysPerYear, vz * daysPerYear, mass * solarMass)
}

let bodies = [
  Body(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, solarMass),
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
]

// Gives the Sun the momentum that makes the system's total zero.
func offsetMomentum() {
  var px = 0.0, py = 0.0, pz = 0.0
  for body in bodies {
    px += body.vx * body.mass
    py += body.vy * body.mass
    pz += body.vz * body.mass
  }
  let sun = bodies[0]
  sun.vx = -px / solarMass
  sun.vy = -py / solarMass
  sun.vz = -pz / solarMass
}

func advance(_ dt: Double) {
  for i in 0..<bodies.count {
    let a = bodies[i]
    for j in (i + 1)..<bodies.count {
      let b = bodies[j]
      let dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z
      let distanceSquared = dx * dx + dy * dy + dz * dz
      let magnitude = dt / (distanceSquared * distanceSquared.squareRoot())
      a.vx -= dx * b.mass * magnitude
      a.vy -= dy * b.mass * magnitude
      a.vz -= dz * b.mass * magnitude
      b.vx += dx * a.mass * magnitude
      b.vy += dy * a.mass * magnitude
      b.vz += dz * a.mass * magnitude
    }
  }
  for body in bodies {
    body.x += dt * body.vx
    body.y += dt * body.vy
    body.z += dt * body.vz
  }
}

func energy() -> Double {
  var e = 0.0
  for i in 0..<bodies.count {
    let a = bodies[i]
    e += 0.5 * a.mass * (a.vx * a.vx + a.vy * a.vy + a.vz * a.vz)
    for j in (i + 1)..<bodies.count {
      let b = bodies[j]
      let dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z
      e -= a.mass * b.mass / (dx * dx + dy * dy + dz * dz).squareRoot()
    }
  }
  return e
}

func inBillionths(_ e: Double) -> Int { Int((e * 1e9).rounded()) }

offsetMomentum()
print(inBillionths(energy()))
for _ in 0..<steps { advance(0.01) }
print(inBillionths(energy()))
