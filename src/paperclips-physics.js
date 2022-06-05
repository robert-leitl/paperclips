import { mat4, quat, vec3 } from 'gl-matrix';
import * as AmmoStartFunc from './libs/ammo';
import { GLBBuilder } from './utils/glb-builder';

export class PaperclipsPhysics {

    tubeBodies = [];
    transformInstance = null;
    impulse = {
        force: null,
        position: null
    };

    // define collision groups to apply raytests only to non-static objects
    envGroup = 0x01;
    objGroup = 0x02;
    rayGroup = 0x04;
    defaultMask = this.envGroup | this.objGroup;
    interactiveMask = this.envGroup | this.objGroup | this.rayGroup;
    rayMask = this.objGroup | this.rayGroup;

    constructor(glb) {
        this.glb = glb;
    }

    async init(numTubes = 1, scale = 2) {
        this.tubeScale = scale;

        this.Ammo = await AmmoStartFunc();
        const Ammo = this.Ammo;

        /** @type {GLBBuilder} */
        const glb = this.glb;

        // reused to get the transformations of rigid bodies
        this.transformInstance = new Ammo.btTransform();

        const collisionConfiguration = new Ammo.btDefaultCollisionConfiguration();
        const dispatcher = new Ammo.btCollisionDispatcher(collisionConfiguration);
        const overlappingPairCache = new Ammo.btDbvtBroadphase();
        const solver = new Ammo.btSequentialImpulseConstraintSolver();

        this.physicsWorld = new Ammo.btDiscreteDynamicsWorld(dispatcher, overlappingPairCache, solver, collisionConfiguration);
        this.physicsWorld.setGravity(new Ammo.btVector3(0, -9, 0));

        Ammo.btGImpactCollisionAlgorithm.prototype.registerAlgorithm(this.physicsWorld.getDispatcher());

        // create the environment enclosing box
        const boundsOffset = 5;
        this.#addStaticPlaneBody(vec3.fromValues(0, 1, 0), 0);
        this.#addStaticPlaneBody(vec3.fromValues(1, 0, 0), -boundsOffset);
        this.#addStaticPlaneBody(vec3.fromValues(-1, 0, 0), -boundsOffset);
        this.#addStaticPlaneBody(vec3.fromValues(0, 0, 1), -boundsOffset);
        this.#addStaticPlaneBody(vec3.fromValues(0, 0, -1), -boundsOffset);
        this.#addStaticPlaneBody(vec3.fromValues(0, -1, 0), -30);

        // create the tube collision shape
        const mesh = new Ammo.btTriangleMesh(true, true);
        const tubeProxyPrimitive = glb.getPrimitiveDataByMeshName('tube-proxy');
        const vertices = tubeProxyPrimitive.buffers.vertices.data;
        const indices = tubeProxyPrimitive.buffers.indices.data;
        const triangleCount = indices.length / 3;
        for (let i = 0; i < triangleCount; i++) {
            mesh.addTriangle(
                new Ammo.btVector3(vertices[indices[i * 3 + 0] * 3], vertices[indices[i * 3 + 0] * 3 + 1], vertices[indices[i * 3 + 0] * 3 + 2]),
                new Ammo.btVector3(vertices[indices[i * 3 + 1] * 3], vertices[indices[i * 3 + 1] * 3 + 1], vertices[indices[i * 3 + 1] * 3 + 2]),
                new Ammo.btVector3(vertices[indices[i * 3 + 2] * 3], vertices[indices[i * 3 + 2] * 3 + 1], vertices[indices[i * 3 + 2] * 3 + 2]),
                false
            );
        }
        this.tubeProxyShape = new Ammo.btGImpactMeshShape(mesh);
        this.tubeProxyShape.setMargin(0.001);
        this.tubeProxyShape.setLocalScaling(new Ammo.btVector3(this.tubeScale, this.tubeScale, this.tubeScale));
        this.tubeProxyShape.updateBound();

        // init interaction event handling
        this.impulse.force = new Ammo.btVector3(0, 1, 0);
        this.impulse.position = new Ammo.btVector3(0, 1, 0);

        for(let i=0; i<numTubes; ++i) {
            this.#addTubeBody(0, i * 10 + 5, 0);
        }
    }

    update(deltaTime) {
        this.physicsWorld.stepSimulation(deltaTime / 1000, 10, 1 / 240);

        const bodyMatrices = [];

        for (let i = 0; i < this.tubeBodies.length; i++) {
            const body = this.tubeBodies[i];
            const ms = body.getMotionState();
            if (ms) {
                ms.getWorldTransform(this.transformInstance);
                const p = this.transformInstance.getOrigin();
                const q = this.transformInstance.getRotation();
                
                const matrix = mat4.fromRotationTranslation(mat4.create(), quat.fromValues(q.x(), q.y(), q.z(), q.w()), vec3.fromValues(p.x(), p.y(), p.z()));
                mat4.scale(matrix, matrix, vec3.fromValues(this.tubeScale, this.tubeScale, this.tubeScale));
                bodyMatrices.push(matrix);
            }
        }

        return bodyMatrices;
    }

    getTubeBodyIndex(tubeBody) {
        return this.tubeBodies.findIndex(body => body === tubeBody);
    }

    getClosestRayHitTestResult(rayStart, rayEnd) {
        // test if a rigid body has been hit
        const rayStartWorldPosAmmoVec3 = new Ammo.btVector3(rayStart[0], rayStart[1], rayStart[2]);
        const rayEndWorldPosAmmoVec3 = new Ammo.btVector3(rayEnd[0], rayEnd[1], rayEnd[2]);
        const hitResult = new Ammo.ClosestRayResultCallback(rayStartWorldPosAmmoVec3, rayEndWorldPosAmmoVec3);
        hitResult.m_collisionFilterGroup = this.rayGroup;
        hitResult.m_collisionFilterMask = this.rayMask;
        this.physicsWorld.rayTest(
            rayStartWorldPosAmmoVec3, 
            rayEndWorldPosAmmoVec3, 
            hitResult
        );

        if (hitResult.hasHit()) {
            const Ammo = this.Ammo;

            const hitPos = hitResult.m_hitPointWorld;
            const hitWorldPos = vec3.fromValues(hitPos.x(), hitPos.y(), hitPos.z());
            const hitBody = Ammo.btRigidBody.prototype.upcast(hitResult.m_collisionObject);

            return {
                body: hitBody,
                position: hitWorldPos
            }
        }

        return null;
    }

    applyImpulse(body, position, force) {
        this.impulse.position.setX(position[0]);
        this.impulse.position.setY(position[1]);
        this.impulse.position.setZ(position[2]);
    
        this.impulse.force.setX(force[0]);
        this.impulse.force.setY(force[1]);
        this.impulse.force.setZ(force[2]);

        body.activate();
        body.applyImpulse(this.impulse.force, this.impulse.position);
    }

    #addStaticPlaneBody(normal, offset) {
        const Ammo = this.Ammo;

        const shape = new Ammo.btStaticPlaneShape(new Ammo.btVector3(normal[0], normal[1], normal[2]), offset);
        shape.setMargin(0.01);
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
        this.physicsWorld.addRigidBody(body, this.envGroup, this.defaultMask);
    }

    #addTubeBody(x, y, z) {
        const Ammo = this.Ammo;

        const mass = .1;
        const transform = new Ammo.btTransform();
        transform.setIdentity();
        transform.setOrigin(new Ammo.btVector3(x, y, z));
        const motionState = new Ammo.btDefaultMotionState(transform);
        const localInertia = new Ammo.btVector3(0, 0, 0);
        this.tubeProxyShape.calculateLocalInertia(mass, localInertia);
        const rbInfo = new Ammo.btRigidBodyConstructionInfo(mass, motionState, this.tubeProxyShape, localInertia);
        const tubeBody = new Ammo.btRigidBody(rbInfo);
        //tubeBody.setFriction(0);
        //tubeBody.setRestitution(0.6);

        this.tubeBodies.push(tubeBody);
        this.physicsWorld.addRigidBody(tubeBody, this.objGroup, this.interactiveMask);
    }
}