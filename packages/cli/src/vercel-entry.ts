import { Container } from '@n8n/di';
import { Server } from './server';
import { AuthRolesService, DbConnection } from '@n8n/db';
import { GlobalConfig } from '@n8n/config';
import { LoadNodesAndCredentials } from './load-nodes-and-credentials';
import { ExternalHooks } from './external-hooks';
import { ActiveWorkflowManager } from './active-workflow-manager';
import { WaitTracker } from './wait-tracker';
import { CredentialsOverwrites } from './credentials-overwrites';
import { DeprecationService } from './deprecation/deprecation.service';
import { AuthHandlerRegistry } from './auth/auth-handler.registry';
import { ExecutionContextHookRegistry, InstanceSettings } from 'n8n-core';
import { ModuleRegistry } from '@n8n/backend-common';

let initialized = false;
let serverInstance: Server;

async function initN8n() {
	if (initialized) return;

	const globalConfig = Container.get(GlobalConfig);
	const instanceSettings = Container.get(InstanceSettings);
	const dbConnection = Container.get(DbConnection);

	// Basic initialization similar to BaseCommand.init()
	await Container.get(LoadNodesAndCredentials).init();
	await dbConnection.init();
	await dbConnection.migrate();

	serverInstance = Container.get(Server);

	// Initialize other essential services from Start.init()
	Container.get(DeprecationService).warn();
	await Container.get(ActiveWorkflowManager).init();

	if (globalConfig.executions.mode === 'regular') {
		instanceSettings.markAsLeader();
	}

	await Container.get(AuthRolesService).init();
	Container.get(WaitTracker).init();
	await Container.get(CredentialsOverwrites).init();
	
	const externalHooks = Container.get(ExternalHooks);
	await externalHooks.init();
	
	const moduleRegistry = Container.get(ModuleRegistry);
	await moduleRegistry.initModules(instanceSettings.instanceType);
	
	await Container.get(AuthHandlerRegistry).init();
	await Container.get(ExecutionContextHookRegistry).init();
	await Container.get(LoadNodesAndCredentials).postProcessLoaders();

	// Custom server initialization for Vercel (skip listen)
	const { app } = serverInstance;
	const http = await import('http');
	(serverInstance as any).server = http.createServer(app);
	(serverInstance as any).externalHooks = externalHooks;
	(serverInstance as any).setupHealthCheck();

	// Start the server (sets up middlewares and controllers)
	await serverInstance.start();

	initialized = true;
}

export default async function handler(req: any, res: any) {
	try {
		await initN8n();
		return serverInstance.app(req, res);
	} catch (error) {
		console.error('Initialization error:', error);
		res.status(500).send('Initialization error');
	}
}
