#version 300 es

precision highp float;

uniform float uFrames;
uniform float uScaleFactor;
uniform vec3 uCameraPosition;

in vec3 vWorldPosition;
in vec3 vWorldNormal;

out vec4 outColor;

void main() {
    vec4 lightColor = vec4(1., 1., 0.7, 0.);
    vec3 lightDirection = vec3(0.1, 0.05, 0.1);

    vec3 P = vWorldPosition;
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(P - uCameraPosition);
    vec3 L = normalize(lightDirection);
    vec3 H = normalize(V + N);
    float NdL = max(0., dot(N, L));

    // specular term
    float specular = pow(max(0., max(0., dot(H, L))), 100.);

    // diffuse term
    float diffuse = NdL;

    // ambient light color
    vec4 ambient = vec4(1., 1., 0.20, 1.);
    
    // the material albedo color
    vec4 albedo = vec4(0., 0., 0., 1.);

    // fresnel term
    vec4 fresnel = smoothstep(0.25, 1., max(0., (1. - dot(-V, N)))) * ambient;

    // fog
    float fog = min(1., P.y / (uScaleFactor * 5.));

    // fake occlusion
    float occlusionFactor = smoothstep(0., .5, P.y);

    outColor = (albedo + lightColor * diffuse + vec4(specular)) * 0.5 + fresnel;

    outColor = mix(outColor, ambient, fog * .8);

    outColor *= occlusionFactor;
}
