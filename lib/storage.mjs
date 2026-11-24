import { get, put, list, head, BlobNotFoundError, BlobPreconditionFailedError } from '@vercel/blob';
export const bucket = {
  async get(path, options={}) {
    if(options.forWrite){
      // Bracket the uncached body read with authoritative metadata. Some origin
      // responses omit or differ in their HTTP ETag; never use an empty ETag
      // to create or overwrite an existing ledger.
      for(let attempt=0;attempt<3;attempt++){
        const before=await this.head(path);
        if(!before)return null;
        const data=await this.get(path);
        const after=await this.head(path);
        if(data&&before.etag&&before.etag===after?.etag)return {...data,etag:before.etag};
        try{await data?.body?.cancel();}catch{}
      }
      throw Error('storage_revision_unavailable');
    }
    let result;
    try{result=await get(path,{access:'private',useCache:false});}catch(error){if(error instanceof BlobNotFoundError)return null;throw error;}
    if (!result) return null;
    return {etag: result.blob.etag, body: result.stream, httpMetadata:{contentType:result.blob.contentType}, json:()=>new Response(result.stream).json()};
  },
  async put(path, value, options={}) {
    const condition=options.onlyIf;
    const createOnly=condition?.etagDoesNotMatch==='*';
    try {
      return await put(path,value,{access:'private',addRandomSuffix:false,allowOverwrite:!createOnly,ifMatch:condition?.etagMatches,contentType:options.httpMetadata?.contentType||'application/json'});
    } catch(error) {
      if(error instanceof BlobPreconditionFailedError || (createOnly && /already exists/i.test(error.message))) return null;
      throw error;
    }
  },
  async head(path) {try{return await head(path);}catch(error){if(error instanceof BlobNotFoundError)return null;throw error;}},
  async list(options) {const page=await list(options);return {objects:page.blobs.map(b=>({key:b.pathname})),truncated:page.hasMore,cursor:page.cursor};}
};
