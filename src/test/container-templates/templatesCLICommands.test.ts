import { assert } from 'chai';
import path from 'path';
import { createPlainLog, LogLevel, makeLog } from '../../spec-utils/log';
import { isLocalFile, readLocalFile } from '../../spec-utils/pfs';
import { ExecResult, shellExec, setupCLI } from '../testUtils';
import { DevContainerCollectionMetadata, packageTemplates } from '../../spec-node/templatesCLI/packageImpl';
import { Template } from '../../spec-configuration/containerTemplatesConfiguration';
import { PackageCommandInput } from '../../spec-node/collectionCommonUtils/package';
import { getCLIHost } from '../../spec-common/cliHost';
import { loadNativeModule } from '../../spec-common/commonUtils';

export const output = makeLog(createPlainLog(text => process.stderr.write(text), () => LogLevel.Trace));

const pkg = require('../../../package.json');

describe('tests apply command', async function () {
	this.timeout('120s');

	const { tmp, cli, installCLI, uninstallCLI } = setupCLI(pkg.version);

	before('Install', async () => {
		await installCLI();
		await shellExec(`rm -rf ${tmp}/output`);
	});
	after('Install', uninstallCLI);

	it('templates apply subcommand', async function () {
		let success = false;
		let result: ExecResult | undefined = undefined;
		try {
			result = await shellExec(`${cli} templates apply --workspace-folder ${path.join(tmp, 'template-output')} \
			--template-id     ghcr.io/devcontainers/templates/docker-from-docker:latest \
			--template-args   '{ "installZsh": "false", "upgradePackages": "true", "dockerVersion": "20.10", "moby": "true", "enableNonRootDocker": "true" }' \
			--features        '[{ "id": "ghcr.io/devcontainers/features/azure-cli:1", "options": { "version" : "1" } }]' \
			--log-level trace`);
			success = true;

		} catch (error) {
			assert.fail('features test sub-command should not throw');
		}

		assert.isTrue(success);
		assert.isDefined(result);
		assert.strictEqual(result.stdout.trim(), '{"files":["./.devcontainer/devcontainer.json"]}');

		const file = (await readLocalFile(path.join(tmp, 'template-output', '.devcontainer', 'devcontainer.json'))).toString();

		assert.match(file, /"name": "Docker from Docker"/);
		assert.match(file, /"installZsh": "false"/);
		assert.match(file, /"upgradePackages": "true"/);
		assert.match(file, /"version": "20.10"/);
		assert.match(file, /"moby": "true"/);
		assert.match(file, /"enableNonRootDocker": "true"/);

		// Assert that the Features included in the template were not removed.
		assert.match(file, /"ghcr.io\/devcontainers\/features\/common-utils:1": {\n/);
		assert.match(file, /"ghcr.io\/devcontainers\/features\/docker-from-docker:1": {\n/);

		// Assert that the Feature included in the command was added.
		assert.match(file, /"ghcr.io\/devcontainers\/features\/azure-cli:1": {\n/);
	});
});

describe('tests packageTemplates()', async function () {
	this.timeout('120s');

	const { tmp, installCLI, uninstallCLI } = setupCLI(pkg.version);

	before('Install', async () => {
		await installCLI();
		await shellExec(`rm -rf ${tmp}/output`);
	});
	after('Install', uninstallCLI);

	const cwd = process.cwd();
	const cliHost = await getCLIHost(cwd, loadNativeModule);

	let args: PackageCommandInput = {
		targetFolder: '',
		outputDir: '',
		output,
		cliHost,
		disposables: [],
		forceCleanOutputDir: true
	};

	// -- Packaging

	it('tests packaging for templates collection', async function () {
		const srcFolder = `${__dirname}/example-templates-sets/simple/src`;
		const outputDir = `${tmp}/output/test01`;

		args.targetFolder = srcFolder;
		args.outputDir = outputDir;

		const metadata = await packageTemplates(args);
		assert.isDefined(metadata);

		const alpineTgzExists = await isLocalFile(`${outputDir}/devcontainer-template-alpine.tgz`);
		assert.isTrue(alpineTgzExists);
		const tgzArchiveContentsAlpine = await shellExec(`tar -tvf ${outputDir}/devcontainer-template-alpine.tgz`);
		assert.match(tgzArchiveContentsAlpine.stdout, /devcontainer-template.json/);
		assert.match(tgzArchiveContentsAlpine.stdout, /.devcontainer.json/);

		const cppTgzExists = await isLocalFile(`${outputDir}/devcontainer-template-cpp.tgz`);
		assert.isTrue(cppTgzExists);
		const tgzArchiveContentsHello = await shellExec(`tar -tvf ${outputDir}/devcontainer-template-cpp.tgz`);
		assert.match(tgzArchiveContentsHello.stdout, /devcontainer-template.json/);
		assert.match(tgzArchiveContentsHello.stdout, /.devcontainer/);
		assert.match(tgzArchiveContentsHello.stdout, /.devcontainer\/Dockerfile/);
		assert.match(tgzArchiveContentsHello.stdout, /.devcontainer\/devcontainer.json/);

		const collectionFileExists = await isLocalFile(`${outputDir}/devcontainer-collection.json`);
		const json: DevContainerCollectionMetadata = JSON.parse((await readLocalFile(`${outputDir}/devcontainer-collection.json`)).toString());
		assert.strictEqual(json.templates.length, 3);
		assert.isTrue(collectionFileExists);

		// Checks if the automatically added properties are set correctly.
		const alpineProperties: Template | undefined = json?.templates.find(t => t.id === 'alpine');
		assert.isNotEmpty(alpineProperties);
		assert.equal(alpineProperties?.type, 'image');
		assert.equal(alpineProperties?.fileCount, 2);
		assert.equal(alpineProperties?.featureIds?.length, 0);

		const cppProperties: Template | undefined = json?.templates.find(t => t.id === 'cpp');
		assert.isNotEmpty(cppProperties);
		assert.equal(cppProperties?.type, 'dockerfile');
		assert.equal(cppProperties?.fileCount, 3);
		assert.equal(cppProperties?.featureIds?.length, 1);
		assert.equal(cppProperties?.featureIds?.[0], 'ghcr.io/devcontainers/features/common-utils');

		const nodeProperties: Template | undefined = json?.templates.find(t => t.id === 'node-mongo');
		assert.isNotEmpty(nodeProperties);
		assert.equal(nodeProperties?.type, 'dockerCompose');
		assert.equal(nodeProperties?.fileCount, 3);
		assert.equal(nodeProperties?.featureIds?.length, 2);
		assert.isTrue(nodeProperties?.featureIds?.some(f => f === 'ghcr.io/devcontainers/features/common-utils'));
		assert.isTrue(nodeProperties?.featureIds?.some(f => f === 'ghcr.io/devcontainers/features/git'));
	});

	it('tests packaging for single template', async function () {
		const singleTemplateFolder = `${__dirname}/example-templates-sets/simple/src/alpine`;
		const outputDir = `${tmp}/output/test02`;

		args.targetFolder = singleTemplateFolder;
		args.outputDir = outputDir;

		const metadata = await packageTemplates(args);
		assert.isDefined(metadata);

		const alpineTgzExists = await isLocalFile(`${outputDir}/devcontainer-template-alpine.tgz`);
		assert.isTrue(alpineTgzExists);
		const tgzArchiveContentsAlpine = await shellExec(`tar -tvf ${outputDir}/devcontainer-template-alpine.tgz`);
		assert.match(tgzArchiveContentsAlpine.stdout, /devcontainer-template.json/);
		assert.match(tgzArchiveContentsAlpine.stdout, /.devcontainer.json/);

		const collectionFileExists = await isLocalFile(`${outputDir}/devcontainer-collection.json`);
		assert.isTrue(collectionFileExists);
		const json: DevContainerCollectionMetadata = JSON.parse((await readLocalFile(`${outputDir}/devcontainer-collection.json`)).toString());
		assert.strictEqual(json.templates.length, 1);
		assert.isTrue(collectionFileExists);

		// Checks if the automatically added `type` property is set correctly.
		const alpineProperties: Template | undefined = json?.templates.find(t => t.id === 'alpine');
		assert.isNotEmpty(alpineProperties);
		assert.equal(alpineProperties?.type, 'image');
		assert.equal(alpineProperties?.fileCount, 2);
	});
});
