// Moved from Loader.js because specs/linking.docx contains real spec text.
//
// This implementation of the ES6 link phase is meant to be quite close to the
// proposed spec, but it is incomplete. It lacks support for AMD-style modules
// (that is, non-default instantiate hooks).



// ## Module Linking
//
// Before we reach this stage, we already have dependencies for each newly
// loaded module or script: that is, load.dependencies, a per-Load mapping of
// request names to full module names. (The values of this mapping are the same
// thing as the evaluation-order dependencies.)
//
// The basic algorithm we want to describe in the spec is:
//
// 0. Create a Module object for each module being linked.
//
// 1. For each module, resolve all `export * from` edges.  This step also
//    computes the complete set of exports for each new module.  The resulting
//    synthetic `export {name} from` edges must be stored somewhere.
//
// 2. Link all exports. For each module in the link set, for each export,
//    create an export binding and a property on the Module object.
//
// 3. For each import, bind it to the corresponding export.
//
// 4. If any error occurred during steps 1-3, discard all the Module objects
//    created in step 0 and linkage fails. Otherwise, linkage succeeds; commit
//    the new, fully linked modules to the loader's module registry.
//
// Implementations have a lot of leeway; they can fuse steps 0 to 3 into a
// single pass over the link set.
//
// Errors can be detected in step 1 (`export * from` cycles, `export *`
// collisions), step 2 (`export from` cycles), or step 3 (imports that do not
// match exports, a module we were depending on was deleted from the Loader).
// If any errors occur, the spec will insert some error token into a Module
// somewhere (details TBD), and then step 4 will reject the LinkSet with an
// exception. If a LinkSet has multiple errors, it is up to the implementation
// which exception is thrown.


// LinkModules(linkSet) is the entry point to linkage; it implements the
// above algorithm.


// Informal definitions of some functions mentioned in the following section:
//
//   * HasImport(loader, m_1, m_2, name) - true if m_1 imports name from m_2
//
//   * HasExport(m, name) - true if name is among m's exports
//
//   * HasPassThroughExport(loader, [m_1, e_1], [m_2, e_2]) -
//     true if m_1 exports m_2[e_2] as e_1.
//     This must find exports of the following forms:
//         export {x} from "M";
//         export * from "M";  // when M exports x
//         export {x};  // in a module that contains an import declaration for x
//
//   * HasExportStarFrom(loader, load_1, load_2) - true if load_1.body contains
//     an `export * from` declaration for load_2.


//> ### Note: Link-time errors (informative)
//>
//> The following are link-time errors. If any of these exist in the LinkSet
//> when linking starts, then linking will fail, with no side effects except
//> that the LinkSet will be rejected. (All the side effects of linkage are
//> applied to new Module objects that are simply discarded on failure.)
//>
//>   * **`import` failures.**
//>     It is a link-time ReferenceError if an import declaration tries to
//>     import a name from a module but the module doesn't export that name.
//>
//>   * **`export from` cycles.**
//>     It is a link-time SyntaxError if one or more modules mutually import a
//>     name from one another in a cycle, such that all of the exports are
//>     pass-through exports, and none of them refer to an actual binding. For
//>     example:
//>
//>         // in module "A"
//>         export {v} from "B";
//>
//>         // in module "B"
//>         export {v} from "A";  // link error: no binding declared anywhere for v
//>
//>   * **`export * from` cycles.**
//>     It is a link-time SyntaxError if one or more modules mutually
//>     `export * from` one another in a cycle. For example:
//>
//>         // in module "A"
//>         export * from "A";  // link error: 'export * from' cycle
//>
//>   * **`export *` collisions.**
//>     It is a link-time SyntaxError if two `export *` declarations in the
//>     same module would export the same name. For example:
//>
//>         // in module "A"
//>         export var x;
//>
//>         // in module "B"
//>         export var x;
//>
//>         // in module "C"
//>         export * from "A";  // link error: both of these modules
//>         export * from "B";  // export something named 'x'
//>
//>   * **Deleted dependencies.**
//>     It is a link error if there exists a module M and a string fullName
//>     such that all of the following are true:
//>     (TODO - tighten up the wording here)
//>       * a Load Record for M exists in loader,
//>       * fullName is in M.[[Dependencies]],
//>       * there is no Load Record for fullName in loads, and
//>       * there is no LoaderRegistryEntry record for fullName in
//>         loader.[[Modules]].
//>
//>     This can occur only if a module required by a Load in loads was
//>     deleted from the loader's module registry using
//>     Loader.prototype.delete.

// **ApparentExports** - Return the List of export LinkageEdges for a given module
// body, including everything that can be determined "locally" (i.e. without
// looking at other module bodies). Exports due to `export *;` are included,
// since they can be determined by looking at this module body, but exports due
// to `export * from "other";` are not.
function ApparentExports(linkingInfo) {
    // In the spec, this would be a syntax-directed algorithm.
    //
    // In the implementation, this could be a primitive provided by the parser;
    // but it's also possible to compute it from the output of $GetLinkingInfo,
    // so that's what we do here.
    //
    // This implementation requires that ordinary `export *;` declarations are
    // desugared by $GetLinkingInfo.
    //
    // The spec can specify a List. This returns an exportName-keyed Map
    // because the caller needs to look up exports by name quickly.
    //
    let result = $MapNew();
    for (let i = 0; i < linkingInfo.length; i++) {
        let edge = linkingInfo[i];
        let name = edge.exportName;
        if (typeof name === "string") {
            $Assert(!$MapHas(result, name));
            $MapSet(result, name, edge);
        }
    }
    return result;
}

// **ExportStarRequestNames** - Return an Array of the strings M that occur in
// the syntactic context `export * from M;` in a given module body.
function ExportStarRequestNames(linkingInfo) {
    // In the spec, this would be a syntax-directed algorithm.
    //
    // In the implementation, this could be a primitive provided by the parser;
    // but it's also possible to compute it from the output of $GetLinkingInfo,
    // so that's what we do here.
    //
    let names = [];
    for (let i = 0; i < linkingInfo.length; i++) {
        let edge = linkingInfo[i];
        if (edge.importName === ALL)
            $ArrayPush(names, edge);
    }
    return names;
}

// **GetModuleImports** - Return an Array that includes one edge for each
// import declaration and each `module ... from` declaration in the given
// module.
function GetModuleImports(linkingInfo) {
    let imports = [];
    for (let i = 0; i < linkingInfo.length; i++) {
        let edge = linkingInfo[i];
        if (edge.importModule !== null && edge.localName !== null)
            $ArrayPush(imports, edge);
    }
    return imports;
}

//> ### GetExports(linkSet, load) Abstract Operation
//>
// (This operation is a combination of ComputeLinkage, ExportedNames, and
// ModuleInstanceExportedNames in the draft spec language.)
//
// Returns a Map with string keys and values of type
// `{importModule: string, importName: string, exportName: string}`
// where the key === value.exportName.
//
// Implementation note:  The spec detects `export * from` cycles early.  This
// implementation instead uses a special value `load.exports === 0` to indicate
// that the set of exports is being computed right now, and detect cycles.
//
function GetExports(linkSet, load) {
    $Assert(load.status === "loaded");
    $Assert(load.fullName !== null);

    let mod = $ModuleBodyToModuleObject(load.body);

    //> 1. If load.[[Exports]] is `"pending"`, throw a SyntaxError exception.
    let exports = load.exports;
    if (exports === 0)
        throw $SyntaxError("'export * from' cycle detected");

    //> 2. If load.[[Exports]] is not **undefined**, then return load.[[Exports]].
    if (exports !== undefined)
        return exports;

    //> 3. Set load.[[Exports]] to `"pending"`.
    load.exports = 0;

    //> 4. Let body be the Module parse stored at load.[[Body]].
    //> 5. Let exports be the ApparentExports of body.
    //
    // Implementation note: As implemented here, steps 5 and 6 each do a pass
    // over load.linkingInfo.  But both those loops can be fused with parsing,
    // and the data could be exposed as primitives by the parser.
    //
    // Implementation note: In the spec, exports is just a List of LinkageEdge
    // Records. In the implementation, it is a Map keyed by the local binding
    // ([[Name]]).
    //
    exports = ApparentExports(load.linkingInfo);

    //> 6. Let names be the ExportStarRequestNames of body.
    let names = ExportStarRequestNames(load.linkingInfo);

    //> 7. Repeat for each requestName in names,
    for (let i = 0; i < names.length; i++) {
        let requestName = names[i];

        //>     1. Let fullName be GetDependencyFullName(load.[[Dependencies]], requestName).
        let fullName = $MapGet(load.dependencies, requestName);

        //>     2. Let depMod be GetModuleFromLoaderRegistry(linkSet.[[Loader]], fullName).
        let starExports;
        let depMod = $MapGet(loaderData.modules, fullName);
        if (depMod !== undefined) {
            //>     3. If depMod is not **undefined**,
            //>         1. Let starExports be depMod.[[Exports]].
            starExports = $GetModuleExportNames(depMod);
        } else {
            //>     4. Else,
            //>         1. Let depLoad be GetLoadFromLoader(linkSet.[[Loader]], fullName).
            let depLoad = $MapGet(loaderData.loads, fullName);

            //>         2. If depLoad is undefined, throw a **SyntaxError** exception.
            //>         3. If depLoad.[[Status]] is `"loaded"`,
            //>             1. Let starExports be GetExports(linkSet, depLoad).
            //>         4. Else if depLoad.[[Status]] is `"linked"`,
            //>             1. Let starExports be depLoad.[[Module]].[[Exports]].
            //>         5. Else, throw a **SyntaxError** exception.
            if (depLoad === undefined ||
                (depLoad.status !== "loaded" && depLoad.status !== "linked"))
            {
                throw $SyntaxError(
                    "module \"" + fullName + "\" was deleted from the loader");
            }

            // Implementation note: unlike the spec, the implementation of
            // GetExports() only bothers to return exports that are not
            // pre-linked by the parser. But in this case we really do need
            // *all* the exports; so we combine the output from GetExports()
            // and $GetModuleExportNames() into a single array.
            starExports = $GetModuleExportNames(depLoad.module);
            if (depLoad.status === "loaded") {
                let moreExports = $MapKeys(GetExports(linkSet, depLoad));
                for (let j = 0; j < moreExports.length; j++)
                    $ArrayPush(starExports, moreExports[j]);
            }
        }

        //>     5. Repeat for each name in starExports,
        for (let j = 0; j < starExports.length; j++) {
            let name = starExports[j];

            // Implementation note: The spec detects this kind of error
            // earlier.  We detect it at the last minute.
            let existingExport = $GetModuleExport(mod, name);
            if ($MapHas(exports, name) ||
                (existingExport !== undefined && $IsExportImplicit(existingExport)))
            {
                throw $SyntaxError(
                    "duplicate export '" + name + "' " +
                    "in module '" + load.fullName + "' " +
                    "due to 'export * from \"" + requestName + "\"'");
            }

            //>         1. If there is not already an edge in exports with the
            //>            [[Name]] name,
            //>             1. Append the new export record {[[ImportModule]]: requestName,
            //>                [[ImportName]]: name, [[ExportName]]: name} to the end of
            //>                the List exports.
            if (existingExport === undefined) {
                $MapSet(exports, name,
                        {importModule: requestName, importName: name, exportName: name});
            }
        }
    }

    //> 8. Set load.[[Exports]] to exports.
    //
    // Implementation note: in the spec, exports is just a List.  This
    // implementation uses a Map for faster lookups by exportName.
    //
    load.exports = exports;

    //> 7. Return exports.
    return exports;
}

//> ### FindModuleForLink(loader, fullName) Abstract Operation
//>
function FindModuleForLink(loader, fullName) {
    let loaderData = GetLoaderInternalData(loader);
    let fullName = deps[i];
    let mod = $MapGet(loaderData.modules, fullName);
    if (mod !== undefined)
        return mod;

    let depLoad = $MapGet(loaderData.loads, fullName);
    if (depLoad === undefined || depLoad.status !== "loaded") {
        throw $SyntaxError(
            "module \"" + fullName + "\" was deleted from the loader");
    }
    return $ModuleBodyToModuleObject(depLoad.body);
}

//> ### LinkExport(loader, load, edge) Abstract Operation
//>
// Implementation note: My theory is that the spec doesn't need visited because
// all errors are detected in an earlier phase. This implementation uses
// visited to detect cycles.
//
// type of edge is:
// {importModule: string, importName: string, exportName: string}
//
// Implementation note: Returns an opaque "export binding" value, created by
// $GetModuleExport, that can be passed to $LinkPassThroughExport if needed.
//
function LinkExport(loader, load, edge, visited) {
    let mod = $ModuleBodyToModuleObject(load.body);

    // If it is already linked, return the export info.  This will be the case
    // for all local exports, so the rest of the algorithm deals only with
    // pass-through exports.
    let existingExport = $GetModuleExport(mod, edge.exportName);
    if (existingExport !== undefined)
        return existingExport;

    let request = edge.importModule;
    let fullName = $MapGet(load.dependencies, request);
    let origin = ResolveExport(loader, fullName, edge.importName, visited);
    if (origin === undefined) {
        throw $ReferenceError(
            "can't export " + edge.importName + " from '" + request + "': " +
            "no matching export in module '" + fullName + "'");
    }
    $LinkPassThroughExport(mod, edge.exportName, origin);
    return origin;
}

//> ### ResolveExport(loader, fullName, exportName) Abstract Operation
//>
function ResolveExport(loader, fullName, exportName, visited) {
    // If fullName refers to an already-linked Module, return that
    // module's export binding for exportName.
    let loaderData = GetLoaderInternalData(loader);
    let mod = $MapGet(loaderData.modules, fullName);
    if (mod !== undefined)
        return $GetModuleExport(mod, exportName);

    let load = $MapGet(loaderData.loads, fullName);
    if (load === undefined)
        throw $SyntaxError("module \"" + fullName + "\" was deleted from the loader");

    if (load.status === "linked") {
        mod = $ModuleBodyToModuleObject(load.body);
        return $GetModuleExport(mod, exportName);
    }

    // Otherwise, if it refers to a load with .status === "loaded", call
    // LinkExport recursively to resolve the upstream export first.  If not,
    // it's an error.
    if (load.status !== "loaded")
        throw $SyntaxError("module \"" + fullName + "\" was deleted from the loader");

    mod = $ModuleBodyToModuleObject(load.body);
    let exp = $GetModuleExport(mod, exportName);
    if (exp !== undefined)
        return exp;

    // The module `mod` does not have a locally apparent export for
    // `exportName`.  If it does not have an `export * from` for that name
    // either, return undefined.
    let edge = $MapGet(load.exports, exportName);
    if (edge === undefined)
        return undefined;

    // Call LinkExport recursively to link the upstream export.
    for (let i = 0; i < visited.length; i++) {
        if (visited[i] === edge)
            throw $SyntaxError("import cycle detected");
    }
    $ArrayPush(visited, edge);
    exp = LinkExport(loader, load, edge, visited);
    visited.length--;
    return exp;
}

//> ### LinkImport(loader, load, edge) Abstract Operation
//>
function LinkImport(loader, load, edge) {
    let mod = $ModuleBodyToModuleObject(load.body);
    let fullName = $MapGet(load.dependencies, edge.importModule);
    let sourceModule = FindModuleForLink(loader, fullName);
    let name = edge.importName;
    if (name === MODULE) {
        $DefineConstant(mod, edge.localName, sourceModule);
    } else {
        let exp = $GetModuleExport(sourceModule, name);
        if (exp === undefined) {
            throw $ReferenceError("can't import name '" + name + "': " +
                                  "no matching export in module '" + fullName + "'");
        }
        $CreateImportBinding(mod, edge.localName, exp);
    }
}

//> ### LinkModules(linkSet) Abstract Operation
//>
//> Link all scripts and modules in linkSet to each other and to modules in the
//> registry.  This is done in a synchronous walk of the graph.  On success,
//> commit all the modules in linkSet to the loader's module registry.
//>
function LinkModules(linkSet) {
    let loads = $SetElements(linkSet.loads);

    try {
        // Find which names are exported by each new module.
        for (let i = 0; i < loads.length; i++) {
            let load = loads[i];
            $Assert(load.status === "loaded" || load.status === "linked");
            if (load.status === "loaded")
                GetExports(load);
        }

        // Link each export. Implementation note: The primitive that creates
        // the Module instance object from the Module body parse automatically
        // creates export bindings in that Module object for all exports except
        // pass-through exports, so this code only links pass-through exports.
        let loader = linkSet.loader;
        for (let i = 0; i < loads.length; i++) {
            let load = loads[i];
            if (load.status === "loaded" && load.fullName !== null) {
                let edges = $MapValues(load.exports);
                for (let j = 0; j < edges.length; j++) {
                    let edge = edges[j];
                    LinkExport(loader, load, edge, []);
                }
            }
        }

        // Link each import.
        for (let i = 0; i < loads.length; i++) {
            let load = loads[i];
            if (load.status === "loaded") {
                let imports = GetModuleImports(load.linkingInfo);
                for (let j = 0; j < loads.length; j++)
                    LinkImport(loader, load, imports[j]);
            }
        }
    } catch (exc) {
        for (let i = 0; i < loads.length; i++) {
            let load = loads[i];
            if (load.status === "loaded" && load.fullName !== null)
                $UnlinkModule($ModuleBodyToModuleObject(load.body));
        }
        throw exc;
    }

    // Set each linked module's list of dependencies, used by
    // EnsureEvaluated.
    for (let i = 0; i < loads.length; i++) {
        let load = loads[i];
        let m = $ModuleBodyToModuleObject(load.body);
        load.module = m;

        let deps = [];
        var depNames = $MapValues(load.dependencies);
        for (let j = 0; j < depNames.length; j++)
            $ArrayPush(deps, FindModuleForLink(depNames[j]));
        $SetDependencies(m, deps);
    }

    // Set the status of Load records for the modules we linked to "linked".
    // Move the fully linked modules from the `loads` table to the `modules`
    // table.
    for (let i = 0; i < loads.length; i++) {
        let load = loads[i];
        let fullName = load.fullName;
        load.status = "linked";
        if (fullName !== undefined)
            $MapSet(loaderData.modules, fullName, load.module);
    }
}

