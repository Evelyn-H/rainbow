#version 450

layout(location=0) out vec4 f_color;

layout(set=0, binding=0)
uniform Uniforms {
    vec2 mouse;
    int width;
    int height;
    float time;
};

#define PI 3.1415926538

const int NUM_STEPS = 128; // doesn't matter much right now
const float MIN_DIST = 0.001; // threshold for intersection
const float MAX_DIST = 1000.0; // oops we went into space


// Struct that allows us to return more data about rays that we marched.
struct Ray {
    float d; 
    float min_d; 
    vec3 end; 
    bool hit;
};

/* DISTANCE ESTIMATORS */    
    
// The distance estimator for a sphere
float sdSphere(vec3 pos, vec3 spherePos, float size) {
	return length(pos - spherePos) - size;
}

// Original from here: https://iquilezles.org/www/articles/distfunctions/distfunctions.htm
float sdRoundBox(vec3 p, vec3 b, float r) {
	vec3 q = abs(p) - b;
	return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

float sdPlane(vec3 p, vec3 n, float h)
{
    // n must be normalized
    return dot(p,n) - h;
}

/* ROTATION */
mat3 rotateX_matrix(float theta) {
    // the -theta is cause the rotation matrices technically have to be reverse-rotation matrices
    float c = cos(-theta);
    float s = sin(-theta);

    return mat3(
        vec3(1, 0, 0),
        vec3(0, c, s),
        vec3(0, -s, c)
    );
}

// vec3 rotateX(vec3 pos, float theta) {
//     return (rotateX_matrix(-theta) * pos);
// }

mat3 rotateY_matrix(float theta) {
    float c = cos(-theta);
    float s = sin(-theta);

    return mat3(
        vec3(c, 0, -s),
        vec3(0, 1, 0),
        vec3(s, 0, c)
    );
}

mat3 rotateZ_matrix(float theta) {
    float c = cos(-theta);
    float s = sin(-theta);

    return mat3(
        vec3(c, s, 0),
        vec3(-s, c, 0),
        vec3(0, 0, 1)
    );
}

vec3 rotate(vec3 pos, vec3 center, mat3 matrix) {
    return matrix * (pos - center) + center;
}



/* OPERATIONS */

// a and b are interchangeable
float opUnion(float a, float b) {
    return min(a,b);
}

// a and b are NOT interchangeable
float opDiff(float a, float b) {
    return max(-a, b);
}

// a and b are interchangeable
float opIntersect(float a, float b) {
    return max(a,b);
}

vec3 opTranslate(vec3 pos, vec3 moves) {
    return pos - moves;
}

/* RENDERING */

mat3 rot_X = rotateX_matrix(time);
mat3 rot_Y = rotateY_matrix(time/4);
mat3 rotation_main = rot_X * rot_Y;

float scene_floorless(vec3 pos) {
    float d = 1e10;

    // box-sphere difference
    vec3 center = vec3(0, 1.5, 0);
    vec3 pos_rotated = rotate(pos, center, rotation_main);
    d = min(d, 
        opIntersect(
            sdSphere(pos_rotated, center, 1.35),
            opDiff(
                sdSphere(pos_rotated, center, 1.25),
                sdRoundBox(opTranslate(pos_rotated, center), vec3(1.0,1.0,1.0), 0.0)
            )
        )
    );

    d = min(d, sdSphere(pos, vec3(2, 0.5, -2), 0.5));
    d = min(d, sdSphere(pos, vec3(3, 1.0, 3), 1.0));
    d = min(d, sdSphere(pos, vec3(-3, 1.5, 2), 1.5));
    d = min(d, sdSphere(pos, vec3(-3, 1.0, 0), 1.0));
    d = min(d, sdSphere(pos, vec3(-2, 0.5, -1), 0.5));
    d = min(d, sdSphere(pos, vec3(-2, 0.25, -2.25), 0.25));

    // origin
    d = min(d, sdSphere(pos, vec3(0, 0, 0), 0.05));

    return d;
    // return sdSphere(pos, vec3(1.0, 0.5, 0.0), 1.0);
}

float scene(vec3 pos) {
    return min(scene_floorless(pos), sdPlane(pos, vec3(0.0, 1.0, 0.0), 0));
}

// vec3 getNormal(in vec3 p) {
// 	const vec2 e = vec2(.0001, 0);
// 	return normalize(vec3(scene(p + e.xyy) - scene(p - e.xyy), scene(p + e.yxy) - scene(p - e.yxy),	scene(p + e.yyx) - scene(p - e.yyx)));
// }

// https://iquilezles.org/www/articles/normalsSDF/normalsSDF.htm
vec3 getNormal(vec3 p)
{
    const float h = 0.0001; // replace by an appropriate value
    const vec2 k = vec2(1,-1);
    return normalize(k.xyy * scene(p + k.xyy*h) + 
                     k.yyx * scene(p + k.yyx*h) + 
                     k.yxy * scene(p + k.yxy*h) + 
                     k.xxx * scene(p + k.xxx*h));
}

vec2 hash32(vec3 p3)
{
	p3 = fract(p3 * vec3(.1031, .1030, .0973));
    p3 += dot(p3, p3.yzx+33.33);
    return fract((p3.xx+p3.yz)*p3.zy);
}

uvec3 pcg3d(uvec3 v) {

    v = v * 1664525u + 1013904223u;

    v.x += v.y*v.z;
    v.y += v.z*v.x;
    v.z += v.x*v.y;

    v ^= v >> 16u;

    v.x += v.y*v.z;
    v.y += v.z*v.x;
    v.z += v.x*v.y;

    return v;
}

vec3 hash23alt(vec2 s){
    s = 353.0*s;
    uvec4 u = uvec4(s, uint(s.x) ^ uint(s.y), uint(s.x) + uint(s.y));
    return vec3(pcg3d(u.xyz)) * (1.0/float(0xffffffffu));
}

Ray march(vec3 origin, vec3 direction) {
    float t = 0.0;
    float d_min = MAX_DIST;
    float t_max = MAX_DIST;

    // raytrace floor plane
    float t_floor = -origin.y / direction.y;
    if (t_floor > 0.0){
        // we should never trace further than to the floor
        t_max = min(t_max, t_floor);
    }
    
    int i = 0;
    for(; i < NUM_STEPS; i++) {
        vec3 current_pos = origin + t * direction;
        
        // Use our distance estimator to find the distance
        float d = scene_floorless(current_pos);
        
        // keep track of the smallest step we've had
        d_min = d < d_min ? d : d_min;
        
        // Check if we hit something or have gone too far
        if (d < MIN_DIST || t > t_max) {
            break;
        }

        // Add the marched distance to total
        t += d;
    }

    vec3 pos = origin + t * direction;
    bool finished = (i == NUM_STEPS || t > t_max);
    // did we hit something?
    if (!finished) {
        return Ray(t, d_min, pos, true);
    }
    // did we hit the floor?
    if (t_floor > 0.0 && finished) {
        return Ray(t_floor, d_min, origin + t_floor * direction, true);
    }
    // else we missed :(
    return Ray(MAX_DIST, d_min, pos, false);
    
}

float cosine_wave(float theta, float min, float max) {
    return (-cos(theta) + 1)/2 * (max-min) + min;
}

void main()
{
    vec2 iResolution = vec2(float(width), float(height));
    float iTime = time;

    // for simplicity we're assuming the camera is always looking at the origin (0,0,0)
    // camera Y-rotation angle in radians
    // float cam_rot_x = cosine_wave(time/2, 0.1, PI/4);
    // float cam_rot_y = time / 8;
    float cam_rot_x = mix(0, PI/4, mouse.y/2+0.5);
    float cam_rot_y = mix(PI, -PI, mouse.x/2+0.5);
    mat3 rot_x = rotateX_matrix(-cam_rot_x);
    mat3 rot_y = rotateY_matrix(cam_rot_y);
    mat3 cam_rotation = rot_y * rot_x;
    vec3 camPos = cam_rotation * vec3(0.0, 0, -8.0);

    int num_levels = 8;
    vec3 color = vec3(0.0);
    for (int i = 0; i < num_levels; i++) {
        // Normalized pixel coordinates (from 0 to 1)
        // vec2 offset = hash32(vec3(gl_FragCoord.xy, fract(iTime) + float(i) / num_levels));
        vec2 offset = hash23alt(gl_FragCoord.xy + iTime + float(i) / num_levels).xy;
        vec2 uv = ((gl_FragCoord.xy + offset) / iResolution.xy) * 2.0 - 1.0;
        uv.y *= -1.0; // flip the y-axis
        
        // this makes sure that the [-1, 1] range is always on the screen regardless of the aspect ratio
        // so in a landscape 16:9 aspect ratio uv.x would be in the range [-1.77, 1.77] and uv.y would be in the range [-1, 1]
        if (iResolution.x > iResolution.y) {
            uv.x = uv.x * (iResolution.x / iResolution.y);
        } else {
            uv.y = uv.y * (iResolution.y / iResolution.x);
        }
        // f_color = vec4(mod(uv.x, 1.0), mod(uv.y, 1.0), 0.0, 1.0);
        
        // vec3 rayDir = normalize(vec3(uv, 1.0));
        // this fixes the horizontal fov to 90 degrees
        float max_u = iResolution.x / iResolution.y;
        vec3 rayDir = cam_rotation * normalize(vec3(uv, max_u));
        
        Ray marched = march(camPos, rayDir);

        vec3 normal = getNormal(marched.end);
        
        color += marched.hit ? 
            // vec3(0.5,1.0,1.0) * vec3(marched.d/pow(float(NUM_STEPS), 0.8) * 4.0) : 
            // vec3(0.0,1.0,1.0) * vec3(pow(clamp(-1.0 * marched.min_d + 1.0, 0.0, 1.0), 4.0) / 2.0);
            // vec3(0.5, 1.0, 1.0) * 1 / marched.d :
            (normal.xzy + 1) / 2 : //the .xzy swizzle is just to make the colors prettier :p
            vec3(0.0, 0.0, 0.0);
    }
    
    f_color = vec4(color / num_levels, 1.0);
}
