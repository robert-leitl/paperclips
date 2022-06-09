#version 300 es

in vec2 aModelPosition;

void main() {
    gl_Position = vec4(aModelPosition, 0., 1.);
}