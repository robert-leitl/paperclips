#version 300 es

precision highp float;

uniform float uFrames;
uniform vec3 uCameraPosition;

in vec3 vWorldPosition;
in vec3 vWorldNormal;

out vec4 outColor;

void main() {
    vec4 lightColor = vec4(1., 1., 1., 0.);
    vec3 lightDirection = vec3(0.1, .1, 0.1);

    vec3 P = vWorldPosition;
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(P - uCameraPosition);
    vec3 L = normalize(lightDirection);
    vec3 H = normalize(V + N);
    float NdL = max(0., dot(N, L));

    // specular term
    float specular = pow(max(0., max(0., dot(H, L))), 100.);

    // diffuse term
    float diffuse = NdL * 0.9;

    // ambient light color
    vec4 ambient = vec4(0.1);
    
    // the material albedo color
    vec4 albedo = vec4(0.1);

    // fake occlusion
    float occlusionFactor = smoothstep(0., .4, vWorldPosition.y) * 0.3 + 0.7;

    outColor = albedo + ambient + lightColor * diffuse + vec4(specular * 0.5);

    outColor *= occlusionFactor;
}
