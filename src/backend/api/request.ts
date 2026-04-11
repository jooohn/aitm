import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/backend/api/error-response";
import { getContainer } from "@/backend/container";
import type { Repository } from "@/backend/domain/repositories";
import type { Worktree } from "@/backend/domain/worktrees";
import { branchToSlug } from "@/lib/utils/branch-slug";

type Success<T> = { ok: true; data: T };
type Failure = { ok: false; response: NextResponse };

export type ApiResult<T> = Success<T> | Failure;

function success<T>(data: T): Success<T> {
  return { ok: true, data };
}

function failure(response: NextResponse): Failure {
  return { ok: false, response };
}

export function mapApiResult<T, U>(
  result: ApiResult<T>,
  fn: (data: T) => U,
): ApiResult<U> {
  if (!result.ok) return result;
  return success(fn(result.data));
}

export async function flatMapApiResult<T, U>(
  result: ApiResult<T>,
  fn: (data: T) => Promise<ApiResult<U>>,
): Promise<ApiResult<U>> {
  if (!result.ok) return result;
  return fn(result.data);
}

export async function tryApiResult<T>(
  fn: () => Promise<T>,
): Promise<ApiResult<T>> {
  try {
    return success(await fn());
  } catch (err) {
    return failure(errorResponse(err));
  }
}

export function invalidBodyResponse(
  error = "Invalid JSON body",
  status = 422,
): NextResponse {
  return NextResponse.json({ error }, { status });
}

export function repositoryNotFoundResponse(
  error = "Repository not found",
): NextResponse {
  return NextResponse.json({ error }, { status: 404 });
}

export function worktreeNotFoundResponse(
  error = "Worktree not found",
): NextResponse {
  return NextResponse.json({ error }, { status: 404 });
}

function formatIssue(issue: z.ZodIssue): string {
  if (issue.message) {
    return issue.message;
  }

  const path = issue.path.length > 0 ? issue.path.join(".") : "body";
  return `${path} is invalid`;
}

function formatZodError(error: z.ZodError): string {
  const [firstIssue] = error.issues;
  return firstIssue ? formatIssue(firstIssue) : "Invalid request body";
}

export async function parseJsonBody<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
  options?: {
    invalidJsonMessage?: string;
    invalidJsonStatus?: number;
    validationStatus?: number;
    formatError?: (error: z.ZodError) => string;
  },
): Promise<ApiResult<z.output<TSchema>>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure(
      invalidBodyResponse(
        options?.invalidJsonMessage,
        options?.invalidJsonStatus ?? 422,
      ),
    );
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    return failure(
      NextResponse.json(
        {
          error:
            options?.formatError?.(result.error) ??
            formatZodError(result.error),
        },
        { status: options?.validationStatus ?? 422 },
      ),
    );
  }

  return success(result.data);
}

export function parseSearchParams<TSchema extends z.ZodType>(
  searchParams: URLSearchParams,
  schema: TSchema,
  options?: {
    validationStatus?: number;
    formatError?: (error: z.ZodError) => string;
  },
): ApiResult<z.output<TSchema>> {
  const values: Record<string, string> = {};
  for (const [key, value] of searchParams.entries()) {
    if (!(key in values)) {
      values[key] = value;
    }
  }

  const result = schema.safeParse(values);
  if (!result.success) {
    return failure(
      NextResponse.json(
        {
          error:
            options?.formatError?.(result.error) ??
            formatZodError(result.error),
        },
        { status: options?.validationStatus ?? 422 },
      ),
    );
  }

  return success(result.data);
}

export async function resolveRepositoryFromParams(
  params: { organization: string; name: string },
  options?: { notFoundMessage?: (alias: string) => string },
): Promise<ApiResult<{ repository: Repository }>> {
  const { repositoryService } = getContainer();
  const alias = `${params.organization}/${params.name}`;
  const repository = await repositoryService.getRepositoryByAlias(alias);
  if (!repository) {
    return failure(
      repositoryNotFoundResponse(
        options?.notFoundMessage?.(alias) ?? "Repository not found",
      ),
    );
  }

  return success({ repository });
}

export async function resolveOptionalRepositoryFilter(
  params: { organization?: string; name?: string },
  options?: { onMissingRepository?: "empty-array" | "not-found" },
): Promise<ApiResult<{ repositoryPath?: string }>> {
  if (!params.organization || !params.name) {
    return success({ repositoryPath: undefined });
  }

  const repositoryResult = await resolveRepositoryFromParams({
    organization: params.organization,
    name: params.name,
  });
  if (!repositoryResult.ok) {
    if (options?.onMissingRepository === "empty-array") {
      return failure(NextResponse.json([]));
    }
    return repositoryResult;
  }

  return success({ repositoryPath: repositoryResult.data.repository.path });
}

export async function resolveWorktreeFromBranchSlug(params: {
  organization: string;
  name: string;
  branch: string;
}): Promise<ApiResult<{ repository: Repository; worktree: Worktree }>> {
  const repositoryResult = await resolveRepositoryFromParams({
    organization: params.organization,
    name: params.name,
  });
  if (!repositoryResult.ok) {
    return repositoryResult;
  }

  const { worktreeService } = getContainer();
  const worktrees = await worktreeService.listWorktrees(
    repositoryResult.data.repository.path,
  );
  const worktree = worktrees.find(
    (candidate) => branchToSlug(candidate.branch) === params.branch,
  );
  if (!worktree) {
    return failure(worktreeNotFoundResponse());
  }

  return success({
    repository: repositoryResult.data.repository,
    worktree,
  });
}
