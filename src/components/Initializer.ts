import * as Vscode from 'vscode';
import * as Fs from 'fs';
import * as FsPromises from 'fs/promises';
import * as Path from 'path';
import * as Jsonfile from 'jsonfile';
import Axios from 'axios';
import Output from './Output';
import Workspace from './Workspace';
import { DENORT_DTS_URL, DENO_CMD_CACHE } from '../values/Constants';
import Asker from './Asker';
import Storage from './Storage';

export default class Initializer {
    private readonly context: Vscode.ExtensionContext;
    private readonly workspace: Workspace;
    private readonly asker: Asker;
    private readonly storage: Storage;

    constructor(context: Vscode.ExtensionContext, workspace: Workspace, asker: Asker, storage: Storage) {
        this.context = context;
        this.workspace = workspace;
        this.asker = asker;
        this.storage = storage;
    }

    private async getLatestVersion(): Promise<string> {
        const axios = Axios.create({ maxRedirects: 0 });
        axios.interceptors.response.use(
            resp => resp,
            err => {
                if (err.response?.status === 302) {
                    return Promise.resolve(err.response);
                } else {
                    return Promise.reject(err);
                }
            }
        );
        const resp = await axios.get(DENORT_DTS_URL);
        const location = resp.headers.location as string;
        if (!location) {
            throw new Error('查询类型定义文件版本失败');
        }

        const ver = location.match(/@(v.+)\//)?.[1];
        if (!ver) {
            throw new Error('查询类型定义文件版本失败');
        }

        return ver;
    }

    private async getLatestUrl(ver?: string): Promise<string> {
        const version = ver ?? (await this.getLatestVersion());
        const url = DENORT_DTS_URL.replace('denort_types', `denort_types@${version}`);
        return url;
    }

    async initializeWorkspace() {
        try {
            const denoConfig = this.workspace.getDenoConfiguration();
            await denoConfig.update('enable', true);
            await denoConfig.update('unstable', true);

            const workspaceFolder = this.workspace.getWorkspaceFolder();
            const denoJson = Path.join(workspaceFolder.uri.fsPath, 'deno.json');
            let denoJsonObject: { compilerOptions: { types: string[] } };
            if (Fs.existsSync(denoJson) && (await FsPromises.readFile(denoJson, { encoding: 'utf-8' })) !== '') {
                denoJsonObject = await Jsonfile.readFile(denoJson);
                denoJsonObject.compilerOptions = denoJsonObject.compilerOptions ?? {};
                denoJsonObject.compilerOptions.types = denoJsonObject.compilerOptions.types ?? [];
            } else {
                denoJsonObject = { compilerOptions: { types: [] } };
            }
            denoJsonObject.compilerOptions.types = denoJsonObject.compilerOptions.types.filter(type => type.indexOf('denort_types') < 0);
            const latestUrl = await this.getLatestUrl();
            if (!denoJsonObject.compilerOptions.types.includes(latestUrl)) {
                denoJsonObject.compilerOptions.types.push(latestUrl);
            }
            Jsonfile.writeFileSync(denoJson, denoJsonObject, { spaces: 4 });

            const root = this.context.extensionPath;
            const mainTs = Path.join(workspaceFolder.uri.fsPath, 'main.ts');
            const mainJs = Path.join(workspaceFolder.uri.fsPath, 'main.js');
            if (!Fs.existsSync(mainTs) && !Fs.existsSync(mainJs)) {
                const mainTsTemplate = Path.join(root, 'assets', 'templates', 'main.ts');
                const mainTsContent = await FsPromises.readFile(mainTsTemplate);
                await FsPromises.writeFile(mainTs, mainTsContent);
            }

            await Vscode.commands.executeCommand(DENO_CMD_CACHE);

            Output.printlnAndShow('Denort 工作区初始化成功');
        } catch (err) {
            Output.eprintln('Denort 工作区初始化失败:', err);
        }
    }

    async updateDenortDts() {
        try {
            const updateDts = this.storage.getUpdateDts();
            if (!updateDts) {
                return;
            }

            const workspaceFolder = this.workspace.getWorkspaceFolder();
            const denoJson = Path.join(workspaceFolder.uri.fsPath, 'deno.json');
            let denoJsonObject: { compilerOptions: { types: string[] } };
            if (Fs.existsSync(denoJson) && (await FsPromises.readFile(denoJson, { encoding: 'utf-8' })) !== '') {
                denoJsonObject = Jsonfile.readFileSync(denoJson);
                denoJsonObject.compilerOptions = denoJsonObject.compilerOptions ?? {};
                denoJsonObject.compilerOptions.types = denoJsonObject.compilerOptions.types ?? [];
            } else {
                denoJsonObject = { compilerOptions: { types: [] } };
            }

            const latestVersion = await this.getLatestVersion();
            const latestUrl = await this.getLatestUrl(latestVersion);
            if (denoJsonObject.compilerOptions.types.includes(latestUrl)) {
                return;
            }

            const update = await this.asker.askForIsUpdateDts(latestVersion);
            if (!update) {
                return;
            }

            denoJsonObject.compilerOptions.types = denoJsonObject.compilerOptions.types.filter(type => type.indexOf('denort_types') < 0);
            denoJsonObject.compilerOptions.types.push(latestUrl);
            await Jsonfile.writeFile(denoJson, denoJsonObject, { spaces: 4 });

            await Vscode.commands.executeCommand(DENO_CMD_CACHE);

            Output.printlnAndShow('更新类型定义文件成功');
        } catch (err) {
            Output.eprintln('更新类型定义文件失败:', err);
        }
    }
}
