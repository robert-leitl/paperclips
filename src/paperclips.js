import { mat4, quat, vec2, vec3, vec4 } from 'gl-matrix';
import { GLBBuilder } from './utils/glb-builder';
import * as AmmoStartFunc from './libs/ammo';
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
        near: 1,
        far: 30,
        fov: Math.PI / 3,
        distance: 7,
        orbit: quat.create(),
        position: vec3.create(),
        rotation: vec3.create(),
        up: vec3.fromValues(0, 0, 1)
    };

    animate = true;

    constructor(canvas, pane, oninit = null) {
        this.canvas = canvas;
        this.pane = pane;
        this.oninit = oninit;

        this.#init();
    }

    rigidBodies = [];
    tmpTrans = null;
    impulse = {
        force: null,
        position: null
    };

    TUBE_SCALE = 2;

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

        // update physics
        this.physicsWorld.stepSimulation(this.#deltaTime / 1000, 10);

        // Update rigid bodies
        //for (let i = 0; i < this.rigidBodies.length; i++) {
            const body = this.rigidBodies[0];
            const ms = body.getMotionState();
            if (ms) {
                ms.getWorldTransform(this.tmpTrans);
                const p = this.tmpTrans.getOrigin();
                const q = this.tmpTrans.getRotation();
                
                //mat4.translate(this.drawUniforms.worldMatrix, rotMat, vec3.fromValues(p.x(), p.y(), p.z()));
                //mat4.fromQuat(mat4.create(), quat.fromValues(q.x(), q.y(), q.z(), q.w()));
                mat4.fromRotationTranslation(this.drawUniforms.worldMatrix, quat.fromValues(q.x(), q.y(), q.z(), q.w()), vec3.fromValues(p.x(), p.y(), p.z()));
            }
        //}

        //this.control.update(this.#deltaTime);
        //mat4.fromQuat(this.drawUniforms.worldMatrix, this.control.rotationQuat);

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

        this.glbBuilder = new GLBBuilder(gl);
        await this.glbBuilder.load(new URL('./assets/models/tube.glb', import.meta.url));

        ///////////////////////////////////  Physics INITIALIZATION

        this.Ammo = await AmmoStartFunc();
        this.#initPhysics();

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
        this.tubePrimitive = this.glbBuilder.primitives.find(item => item.meshName == 'tube-simplified');
        this.tubeBuffers = this.tubePrimitive.buffers;
        this.tubeVAO = makeVertexArray(gl, [
            [this.tubeBuffers.vertices.webglBuffer, 0, this.tubeBuffers.vertices.numberOfComponents],
            [this.tubeBuffers.normals.webglBuffer, 1, this.tubeBuffers.normals.numberOfComponents]
        ], this.tubeBuffers.indices.webglBuffer);

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

        this.camera.position[1] = -this.camera.distance;
        this.#updateCameraMatrix();
        this.#updateProjectionMatrix(gl);

        this.initTweakpane();

        if (this.oninit) this.oninit(this);
    }

    #initPhysics() {
        const Ammo = this.Ammo;

        // reused to get the transformations of rigid bodies
        this.tmpTrans = new Ammo.btTransform();

        const collisionConfiguration = new Ammo.btDefaultCollisionConfiguration();
        const dispatcher = new Ammo.btCollisionDispatcher(collisionConfiguration);
        const overlappingPairCache = new Ammo.btDbvtBroadphase();
        const solver = new Ammo.btSequentialImpulseConstraintSolver();

        this.physicsWorld = new Ammo.btDiscreteDynamicsWorld(dispatcher, overlappingPairCache, solver, collisionConfiguration);
        this.physicsWorld.setGravity(new Ammo.btVector3(0, -80, 0));

        // define collision groups to apply raytests only to non-static objects
        const envGroup = 0x01;
        const objGroup = 0x02;
        const rayGroup = 0x04;
        const defaultMask = envGroup | objGroup;
        const interactiveMask = envGroup | objGroup | rayGroup;
        const rayMask = objGroup | rayGroup;

        Ammo.btGImpactCollisionAlgorithm.prototype.registerAlgorithm(this.physicsWorld.getDispatcher());

        // create the environment enclosing box
        const boundsOffset = 5;
        this.#addStaticPlaneShape(vec3.fromValues(0, 1, 0), 0, envGroup, defaultMask);
        this.#addStaticPlaneShape(vec3.fromValues(1, 0, 0), -boundsOffset, envGroup, defaultMask);
        this.#addStaticPlaneShape(vec3.fromValues(-1, 0, 0), -boundsOffset, envGroup, defaultMask);
        this.#addStaticPlaneShape(vec3.fromValues(0, 0, 1), -boundsOffset, envGroup, defaultMask);
        this.#addStaticPlaneShape(vec3.fromValues(0, 0, -1), -boundsOffset, envGroup, defaultMask);
        this.#addStaticPlaneShape(vec3.fromValues(0, -1, 0), -30, envGroup, defaultMask);

        // create the tube collision shape
        const mesh = new Ammo.btTriangleMesh(true, true);
        const tubeProxyPrimitive = this.glbBuilder.primitives.find(item => item.meshName == 'tube-proxy');
        const vertices = tubeProxyPrimitive.buffers.vertices.data;
        const indices = tubeProxyPrimitive.buffers.indices.data;
        for (let i = 0; i * 3 < indices.length; i++) {
            mesh.addTriangle(
                new Ammo.btVector3(vertices[indices[i * 3] * 3], vertices[indices[i * 3] * 3 + 1], vertices[indices[i * 3] * 3 + 2]),
                new Ammo.btVector3(vertices[indices[i * 3 + 1] * 3], vertices[indices[i * 3 + 1] * 3 + 1], vertices[indices[i * 3 + 1] * 3 + 2]),
                new Ammo.btVector3(vertices[indices[i * 3 + 2] * 3], vertices[indices[i * 3 + 2] * 3 + 1], vertices[indices[i * 3 + 2] * 3 + 2]),
                false
            );
        }
        this.tubeProxyShape = new Ammo.btGImpactMeshShape(mesh);
        this.tubeProxyShape.setMargin(0.01);
        this.tubeProxyShape.updateBound();

        this.#addTube(objGroup, interactiveMask);


        // init interaction event handling
        this.impulse.force = new Ammo.btVector3(0, 1, 0);
        this.impulse.position = new Ammo.btVector3(0, 1, 0);

        this.canvas.addEventListener('click', (e) => {
            const body = this.rigidBodies[0];

            // calculate the clicked point on the far plane
            const x = (e.clientX / this.canvas.clientWidth) * 2 - 1;
            const y = (1 - (e.clientY / this.canvas.clientHeight)) * 2 - 1;
            const z = 1; // at camera far plane
            const ndcPos = vec3.fromValues(x, y, z); 
            const viewPos = vec3.transformMat4(vec3.create(), ndcPos, this.drawUniforms.inversProjectionMatrix);
            const inversViewProjectionMatrix = mat4.multiply(mat4.create(), this.drawUniforms.cameraMatrix, this.drawUniforms.inversProjectionMatrix);
            const worldPos = vec4.transformMat4(vec4.create(), vec4.fromValues(ndcPos[0], ndcPos[1], ndcPos[2], 1), inversViewProjectionMatrix);
            if (worldPos[3] !== 0){
                vec3.scale(worldPos, worldPos, 1 / worldPos[3]);
            }

            // test if a rigid body has been hit
            const rayStartWorldPos = vec3.clone(this.camera.position);
            const rayStartWorldPosAmmoVec3 = new Ammo.btVector3(rayStartWorldPos[0], rayStartWorldPos[1], rayStartWorldPos[2]);
            const rayEndWorldPos = worldPos;
            const rayEndWorldPosAmmoVec3 = new Ammo.btVector3(rayEndWorldPos[0], rayEndWorldPos[1], rayEndWorldPos[2]);
            const hitResult = new Ammo.ClosestRayResultCallback(rayStartWorldPosAmmoVec3, rayEndWorldPosAmmoVec3);
            hitResult.m_collisionFilterGroup = rayGroup;
            hitResult.m_collisionFilterMask = rayMask;
            this.physicsWorld.rayTest(
                rayStartWorldPosAmmoVec3, 
                rayEndWorldPosAmmoVec3, 
                hitResult
            );

            if (hitResult.hasHit()) {
                const hitPos = hitResult.m_hitPointWorld;
                const hitWorldPos = vec3.fromValues(hitPos.x(), hitPos.y(), hitPos.z());
                // transform to model space
                const inversModelMatrix = mat4.invert(mat4.create(), this.drawUniforms.worldMatrix);
                const hitModelPos = vec3.transformMat4(vec3.create(), hitWorldPos, inversModelMatrix);

                // apply the hit position in model space as the impulse rel position
                this.impulse.position.setX(hitModelPos[0]);
                this.impulse.position.setY(hitModelPos[1]);
                this.impulse.position.setZ(hitModelPos[2]);
                
                // calculate the force vector from the hit ray
                const force = vec3.normalize(vec3.create(), vec3.subtract(vec3.create(), rayEndWorldPos, rayStartWorldPos));
                vec3.scale(force, force, 3.);
                this.impulse.force.setX(force[0]);
                this.impulse.force.setY(force[1]);
                this.impulse.force.setZ(force[2]);

                body.activate();
                body.applyImpulse(this.impulse.force, this.impulse.position);
            }
        });
    }

    #addStaticPlaneShape(normal, offset, collisionGroup, collisionMask) {
        const Ammo = this.Ammo;

        const shape = new Ammo.btStaticPlaneShape(new Ammo.btVector3(normal[0], normal[1], normal[2]), offset);
        shape.setMargin( 0.01 );
        const transform = new Ammo.btTransform();
        transform.setIdentity();
        let info = new Ammo.btRigidBodyConstructionInfo(
            0, 
            new Ammo.btDefaultMotionState(transform), 
            shape, 
            new Ammo.btVector3(0, 0, 0)
        );
        let body = new Ammo.btRigidBody(info);
        body.setRestitution(1);
        this.physicsWorld.addRigidBody(body, collisionGroup, collisionMask);
    }

    #addTube(collisionGroup, collisionMask) {
        const Ammo = this.Ammo;

        const mass = 0.1;
        const transform = new Ammo.btTransform();
        transform.setIdentity();
        transform.setOrigin(new Ammo.btVector3(0, 5, 0));
        const motionState = new Ammo.btDefaultMotionState(transform);
        const localInertia = new Ammo.btVector3(0, 0, 0);
        this.tubeProxyShape.calculateLocalInertia(mass, localInertia);
        const rbInfo = new Ammo.btRigidBodyConstructionInfo(mass, motionState, this.tubeProxyShape, localInertia);
        const tubeBody = new Ammo.btRigidBody(rbInfo);
        tubeBody.setFriction(1);
        tubeBody.setRestitution(0.6);

        this.rigidBodies.push(tubeBody);
        this.physicsWorld.addRigidBody(tubeBody, collisionGroup, collisionMask);
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
        mat4.perspective(this.drawUniforms.projectionMatrix, this.camera.fov, aspect, this.camera.near, this.camera.far);
        mat4.invert(this.drawUniforms.inversProjectionMatrix, this.drawUniforms.projectionMatrix);
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
