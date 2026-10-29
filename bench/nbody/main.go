// Simulates the Sun and the four giant planets for a number of steps, and prints their energy before
// and after, in billionths, rounded.
package main

import (
	"fmt"
	"math"
)

const (
	solarMass   = 4.0 * math.Pi * math.Pi
	daysPerYear = 365.24
	steps       = 10000000
)

type Body struct {
	x, y, z, vx, vy, vz, mass float64
}

func planet(x, y, z, vx, vy, vz, mass float64) *Body {
	return &Body{x, y, z, vx * daysPerYear, vy * daysPerYear, vz * daysPerYear, mass * solarMass}
}

var bodies = []*Body{
	{0.0, 0.0, 0.0, 0.0, 0.0, 0.0, solarMass},
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
}

// Gives the Sun the momentum that makes the system's total zero.
func offsetMomentum() {
	px, py, pz := 0.0, 0.0, 0.0
	for _, body := range bodies {
		px += body.vx * body.mass
		py += body.vy * body.mass
		pz += body.vz * body.mass
	}
	sun := bodies[0]
	sun.vx = -px / solarMass
	sun.vy = -py / solarMass
	sun.vz = -pz / solarMass
}

func advance(dt float64) {
	for i, a := range bodies {
		for _, b := range bodies[i+1:] {
			dx, dy, dz := a.x-b.x, a.y-b.y, a.z-b.z
			distanceSquared := dx*dx + dy*dy + dz*dz
			magnitude := dt / (distanceSquared * math.Sqrt(distanceSquared))
			a.vx -= dx * b.mass * magnitude
			a.vy -= dy * b.mass * magnitude
			a.vz -= dz * b.mass * magnitude
			b.vx += dx * a.mass * magnitude
			b.vy += dy * a.mass * magnitude
			b.vz += dz * a.mass * magnitude
		}
	}
	for _, body := range bodies {
		body.x += dt * body.vx
		body.y += dt * body.vy
		body.z += dt * body.vz
	}
}

func energy() float64 {
	e := 0.0
	for i, a := range bodies {
		e += 0.5 * a.mass * (a.vx*a.vx + a.vy*a.vy + a.vz*a.vz)
		for _, b := range bodies[i+1:] {
			dx, dy, dz := a.x-b.x, a.y-b.y, a.z-b.z
			e -= a.mass * b.mass / math.Sqrt(dx*dx+dy*dy+dz*dz)
		}
	}
	return e
}

func inBillionths(e float64) int64 { return int64(math.Round(e * 1e9)) }

func main() {
	offsetMomentum()
	fmt.Println(inBillionths(energy()))
	for i := 0; i < steps; i++ {
		advance(0.01)
	}
	fmt.Println(inBillionths(energy()))
}
