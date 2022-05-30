import { mat4, quat, vec2, vec3 } from 'gl-matrix';
import { GLBBuilder } from './utils/glb-builder';
import { createAndSetupTexture, createFramebuffer, createProgram, makeBuffer, makeVertexArray, resizeCanvasToDisplaySize, setFramebuffer } from './utils/webgl-utils';

import tubeVertShaderSource from './shader/tube.vert';
import tubeFragShaderSource from './shader/tube.frag';
import { ArcballControl } from './utils/arcball-control';

export class Paperclips {
    oninit;

    #time = 0;
    #frames = 0;
    #deltaTime = 0;
    #isDestroyed = false;

    camera = {
        matrix: mat4.create(),
        near: 3,
        far: 10,
        distance: 5,
        orbit: quat.create(),
        position: vec3.create(),
        rotation: vec3.create(),
        up: vec3.fromValues(0, 1, 0)
    };

    animate = true;

    constructor(canvas, pane, oninit = null) {
        this.canvas = canvas;
        this.pane = pane;
        this.oninit = oninit;

        this.#init();
    }

    resize() {
        const gl = this.gl;

        const needsResize = resizeCanvasToDisplaySize(gl.canvas);
        
        if (needsResize) {
            gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
            this.#resizeTextures(gl);
        }

        this.#updateProjectionMatrix(gl);
    }

    run(time = 0) {
        if(this.fpsGraph) this.fpsGraph.begin();

        this.#deltaTime = Math.min(32, time - this.#time);
        this.#time = time;

        this.control.update(this.#deltaTime);
        mat4.fromQuat(this.drawUniforms.worldMatrix, this.control.rotationQuat);

        // update the world inverse transpose
        mat4.invert(this.drawUniforms.worldInverseTransposeMatrix, this.drawUniforms.worldMatrix);
        mat4.transpose(this.drawUniforms.worldInverseTransposeMatrix, this.drawUniforms.worldInverseTransposeMatrix);

        if (this.animate)
            this.#frames += this.#deltaTime / 16;

        if (this.#isDestroyed) return;

        this.#render();

        if(this.fpsGraph) this.fpsGraph.end();

        requestAnimationFrame((t) => this.run(t));
    }

    #render() {
        /** @type {WebGLRenderingContext} */
        const gl = this.gl;


        gl.useProgram(this.tubeProgram);

        gl.enable(gl.CULL_FACE);
        gl.enable(gl.DEPTH_TEST);

        gl.uniformMatrix4fv(this.tubeLocations.uViewMatrix, false, this.drawUniforms.viewMatrix);
        gl.uniformMatrix4fv(this.tubeLocations.uProjectionMatrix, false, this.drawUniforms.projectionMatrix);
        gl.uniform3f(this.tubeLocations.uCameraPosition, this.camera.position[0], this.camera.position[1], this.camera.position[2]);
        gl.uniformMatrix4fv(this.tubeLocations.uWorldMatrix, false, this.drawUniforms.worldMatrix);
        gl.uniformMatrix4fv(this.tubeLocations.uWorldInverseTransposeMatrix, false, this.drawUniforms.worldInverseTransposeMatrix);
        gl.uniform1f(this.tubeLocations.uFrames, this.#frames);

        gl.bindVertexArray(this.tubeVAO);
        gl.drawElements(gl.TRIANGLES, this.tubeBuffers.indices.length, gl.UNSIGNED_SHORT, 0);

    }

    destroy() {
        this.#isDestroyed = true;
    }

    async #init() {
        this.gl = this.canvas.getContext('webgl2', { antialias: false, alpha: false });

        /** @type {WebGLRenderingContext} */
        const gl = this.gl;

        if (!gl) {
            throw new Error('No WebGL 2 context!')
        }

        if (!gl.getExtension("EXT_color_buffer_float")) {
            console.error("FLOAT color buffer not available");
            document.body.innerHTML = "This example requires EXT_color_buffer_float which is unavailable on this system."
        }

        ///////////////////////////////////  LOAD RESOURCES

        const glbBuilder = new GLBBuilder(gl);
        await glbBuilder.load(new URL('./assets/models/tube.glb', import.meta.url));
        console.log(glbBuilder);

        ///////////////////////////////////  PROGRAM SETUP

        // setup programs
        this.tubeProgram = createProgram(gl, [tubeVertShaderSource, tubeFragShaderSource], null, { aModelPosition: 0, aModelNormal: 1 });

        // find the locations
        this.tubeLocations = {
            aModelPosition: gl.getAttribLocation(this.tubeProgram, 'aModelPosition'),
            aModelNormal: gl.getAttribLocation(this.tubeProgram, 'aModelNormal'),
            uWorldMatrix: gl.getUniformLocation(this.tubeProgram, 'uWorldMatrix'),
            uViewMatrix: gl.getUniformLocation(this.tubeProgram, 'uViewMatrix'),
            uProjectionMatrix: gl.getUniformLocation(this.tubeProgram, 'uProjectionMatrix'),
            uWorldInverseTransposeMatrix: gl.getUniformLocation(this.tubeProgram, 'uWorldInverseTransposeMatrix'),
            uCameraPosition: gl.getUniformLocation(this.tubeProgram, 'uCameraPosition'),
            uFrames: gl.getUniformLocation(this.tubeProgram, 'uFrames')
        };
        
        // setup uniforms
        this.drawUniforms = {
            worldMatrix: mat4.create(),
            viewMatrix: mat4.create(),
            cameraMatrix: mat4.create(),
            projectionMatrix: mat4.create(),
            inversProjectionMatrix: mat4.create(),
            worldInverseTransposeMatrix: mat4.create()
        };

        /////////////////////////////////// GEOMETRY / MESH SETUP

        // create tube VAO
        this.tubePrimitive = glbBuilder.primitives.find(item => item.meshName == 'tube-simplified');
        this.tubeBuffers = this.tubePrimitive.buffers;
        this.tubeVAO = makeVertexArray(gl, [
            [this.tubeBuffers.vertices.data, 0, this.tubeBuffers.vertices.numberOfComponents],
            [this.tubeBuffers.normals.data, 1, this.tubeBuffers.normals.numberOfComponents]
        ], this.tubeBuffers.indices.data);

        // create quad VAO
        const quadPositions = [-1, -1, 3, -1, -1, 3];
        this.quadBuffers = {
            position: makeBuffer(gl, new Float32Array(quadPositions), gl.STATIC_DRAW),
            numElem: quadPositions.length / 2
        };
        this.quadVAO = makeVertexArray(gl, [[this.quadBuffers.position, 0, 2]]);

        /////////////////////////////////// FRAMEBUFFER SETUP

        // initial client dimensions
        const clientSize = vec2.fromValues(gl.canvas.clientWidth, gl.canvas.clientHeight);
        this.drawBufferSize = vec2.clone(clientSize);
        
        // init the pointer rotate control
        this.control = new ArcballControl(this.canvas);

        this.resize();

        this.camera.position[2] = this.camera.distance;
        this.#updateCameraMatrix();
        this.#updateProjectionMatrix(gl);

        this.initTweakpane();

        if (this.oninit) this.oninit(this);
    }

    #resizeTextures(gl) {
        const clientSize = vec2.fromValues(gl.canvas.clientWidth, gl.canvas.clientHeight);
        this.drawBufferSize = vec2.clone(clientSize);
        
        /*this.#resizeTexture(gl, this.plantColorTexture, gl.RGBA, clientSize);
        this.#resizeTexture(gl, this.plantDepthTexture, gl.DEPTH_COMPONENT32F, clientSize);
        this.#resizeTexture(gl, this.deltaDepthColorTexture, gl.RGBA, clientSize);
        this.#resizeTexture(gl, this.hBlurTexture, gl.RGBA, clientSize);
        this.#resizeTexture(gl, this.vBlurTexture, gl.RGBA, clientSize);*/

        // reset bindings
        gl.bindRenderbuffer(gl.RENDERBUFFER, null);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    #resizeTexture(gl, texture, format, size) {
        gl.bindTexture(gl.TEXTURE_2D, texture);

        if (format === gl.RGBA) 
            gl.texImage2D(gl.TEXTURE_2D, 0, format, size[0], size[1], 0, format, gl.UNSIGNED_BYTE, null);
        else if (format === gl.DEPTH_COMPONENT32F) 
            gl.texImage2D(gl.TEXTURE_2D, 0, format, size[0], size[1], 0, gl.DEPTH_COMPONENT, gl.FLOAT, null);

        gl.bindTexture(gl.TEXTURE_2D, null);
    }

    #updateCameraMatrix() {
        mat4.targetTo(this.camera.matrix, this.camera.position, [0, 0, 0], this.camera.up);
        mat4.invert(this.drawUniforms.viewMatrix, this.camera.matrix);
        mat4.copy(this.drawUniforms.cameraMatrix, this.camera.matrix);
    }

    #updateProjectionMatrix(gl) {
        const aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
        mat4.perspective(this.drawUniforms.projectionMatrix, Math.PI / 4, aspect, this.camera.near, this.camera.far);
    }

    initTweakpane() {
        if (this.pane) {
            const maxFar = 200;

            this.fpsGraph = this.pane.addBlade({
                view: 'fpsgraph',
                label: 'fps',
                lineCount: 1,
                maxValue: 120,
                minValue: 0
            });

            //this.pane.addInput(this, 'animate', { label: 'animate plant' });

            //const cameraFolder = this.pane.addFolder({ title: 'Camera' });
            //this.#createTweakpaneSlider(cameraFolder, this.camera, 'near', 'near', 1, maxFar, null, () => this.#updateProjectionMatrix(this.gl));
            //this.#createTweakpaneSlider(cameraFolder, this.camera, 'far', 'far', 1, maxFar, null, () => this.#updateProjectionMatrix(this.gl));

            /*const particlesFolder = this.pane.addFolder({ title: 'Particles' });
            this.#createTweakpaneSlider(particlesFolder, this.particles.settings, 'velocity', 'velocity', 0, 10, null);
            this.#createTweakpaneSlider(particlesFolder, this.particles.settings, 'curl', 'curl', 0, 10, null);
            this.#createTweakpaneSlider(particlesFolder, this.particles.settings, 'noise', 'noise', 0, 10, null);

            const refractionFolder = this.pane.addFolder({ title: 'Refraction' });
            this.#createTweakpaneSlider(refractionFolder, this.refractionSettings, 'strength', 'strength', 0, 1, null);
            this.#createTweakpaneSlider(refractionFolder, this.refractionSettings, 'dispersion', 'dispersion', 0, 10, null);*/

            //const plantFolder = this.pane.addFolder({ title: 'Plant' });
            /*const plantGenerateBtn = plantFolder.addButton({ title: 'generate' });
            plantGenerateBtn.on('click', () => this.plant.generate(this.#frames));*/
        }
    }

    #createTweakpaneSlider(folder, obj, propName, label, min, max, stepSize = null, callback) {
        const slider = folder.addBlade({
            view: 'slider',
            label,
            min,
            max,
            step: stepSize,
            value: obj[propName],
        });
        slider.on('change', e => {
            obj[propName] = e.value;
            if(callback) callback();
        });
    }
}
