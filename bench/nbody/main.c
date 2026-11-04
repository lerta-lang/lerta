#include <inttypes.h>
#include <math.h>
#include <stdio.h>

// Simulates the Sun and the four giant planets for a number of steps, and prints their energy before
// and after, in billionths, rounded.
#define PI 3.141592653589793
#define SOLAR_MASS (4.0 * PI * PI)
#define DAYS_PER_YEAR 365.24
#define STEPS 10000000
#define BODIES 5

typedef struct {
  double x, y, z, vx, vy, vz, mass;
} Body;

#define PLANET(x, y, z, vx, vy, vz, mass)                                                          \
  {x, y, z, vx * DAYS_PER_YEAR, vy * DAYS_PER_YEAR, vz * DAYS_PER_YEAR, mass * SOLAR_MASS}

static Body bodies[BODIES] = {
    {0.0, 0.0, 0.0, 0.0, 0.0, 0.0, SOLAR_MASS},
    PLANET(4.84143144246472090e+00, -1.16032004402742839e+00, -1.03622044471123109e-01,
           1.66007664274403694e-03, 7.69901118419740425e-03, -6.90460016972063023e-05,
           9.54791938424326609e-04),
    PLANET(8.34336671824457987e+00, 4.12479856412430479e+00, -4.03523417114321381e-01,
           -2.76742510726862411e-03, 4.99852801234917238e-03, 2.30417297573763929e-05,
           2.85885980666130812e-04),
    PLANET(1.28943695621391310e+01, -1.51111514016986312e+01, -2.23307578892655734e-01,
           2.96460137564761618e-03, 2.37847173959480950e-03, -2.96589568540237556e-05,
           4.36624404335156298e-05),
    PLANET(1.53796971148509165e+01, -2.59193146099879641e+01, 1.79258772950371181e-01,
           2.68067772490389322e-03, 1.62824170038242295e-03, -9.51592254519715870e-05,
           5.15138902046611451e-05),
};

// Gives the Sun the momentum that makes the system's total zero.
static void offset_momentum(void) {
  double px = 0.0, py = 0.0, pz = 0.0;
  for (int i = 0; i < BODIES; i++) {
    px += bodies[i].vx * bodies[i].mass;
    py += bodies[i].vy * bodies[i].mass;
    pz += bodies[i].vz * bodies[i].mass;
  }
  bodies[0].vx = -px / SOLAR_MASS;
  bodies[0].vy = -py / SOLAR_MASS;
  bodies[0].vz = -pz / SOLAR_MASS;
}

static void advance(double dt) {
  for (int i = 0; i < BODIES; i++) {
    Body *a = &bodies[i];
    for (int j = i + 1; j < BODIES; j++) {
      Body *b = &bodies[j];
      double dx = a->x - b->x, dy = a->y - b->y, dz = a->z - b->z;
      double distance_squared = dx * dx + dy * dy + dz * dz;
      double magnitude = dt / (distance_squared * sqrt(distance_squared));
      a->vx -= dx * b->mass * magnitude;
      a->vy -= dy * b->mass * magnitude;
      a->vz -= dz * b->mass * magnitude;
      b->vx += dx * a->mass * magnitude;
      b->vy += dy * a->mass * magnitude;
      b->vz += dz * a->mass * magnitude;
    }
  }
  for (int i = 0; i < BODIES; i++) {
    bodies[i].x += dt * bodies[i].vx;
    bodies[i].y += dt * bodies[i].vy;
    bodies[i].z += dt * bodies[i].vz;
  }
}

static double energy(void) {
  double e = 0.0;
  for (int i = 0; i < BODIES; i++) {
    Body *a = &bodies[i];
    e += 0.5 * a->mass * (a->vx * a->vx + a->vy * a->vy + a->vz * a->vz);
    for (int j = i + 1; j < BODIES; j++) {
      Body *b = &bodies[j];
      double dx = a->x - b->x, dy = a->y - b->y, dz = a->z - b->z;
      e -= a->mass * b->mass / sqrt(dx * dx + dy * dy + dz * dz);
    }
  }
  return e;
}

static int64_t in_billionths(double e) { return llround(e * 1e9); }

int main(void) {
  offset_momentum();
  printf("%" PRId64 "\n", in_billionths(energy()));
  for (int i = 0; i < STEPS; i++) advance(0.01);
  printf("%" PRId64 "\n", in_billionths(energy()));
  return 0;
}
