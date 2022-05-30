#version 300 es

uniform mat4 uWorldMatrix;
uniform mat4 uViewMatrix;
uniform mat4 uProjectionMatrix;
uniform mat4 uWorldInverseTransposeMatrix;
uniform vec3 uCameraPosition;

in vec3 aModelPosition;
in vec3 aModelNormal;

out vec3 vWorldPosition;
out vec3 vWorldNormal;

void main() {
    vec4 worldPosition = uWorldMatrix * vec4(aModelPosition, 1.);

    vWorldPosition = worldPosition.xyz;
    vWorldNormal = (uWorldInverseTransposeMatrix * vec4(aModelNormal, 0.)).xyz;

    gl_Position = uProjectionMatrix * uViewMatrix * worldPosition;
}