import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth, useUser } from "@/lib/clerk";
import { useToast } from "@/hooks/use-toast";
import { projectService, ProjectRecord } from "@/services/projectService";
import { useChatStore } from "@/chat/useChatStore";
import { useNavigate } from "@/lib/navigation";

export interface Project {
    id: string;
    title: string;
    updated_at?: string;
    created_at?: string;
}

type RefreshOptions = {
    force?: boolean;
    showLoading?: boolean;
    dedupe?: boolean;
};

const PROJECTS_STALE_MS = 60_000;

const projectsQueryKey = (userId: string) => ["projects", userId] as const;

const parseDate = (value?: string | null) => {
    if (!value) return 0;
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? 0 : timestamp;
};

const mapProject = (project: ProjectRecord): Project => ({
    id: project.id,
    title: project.name || project.dashboard_title || "Untitled Project",
    updated_at: project.updated_at,
    created_at: project.created_at,
});

// Map + sort ALL of the user's projects newest-first. No cap — the workspace
// sidebar shows the full list and scrolls.
//
// This sort is load-bearing and must stay: GET /projects orders by created_at
// ASC server-side, which is not the order the sidebar wants. It is also why
// /projects is currently excluded from cursor pagination.
const mapProjects = (projects: ProjectRecord[]): Project[] => (
    projects
        .map(mapProject)
        .sort((a, b) => {
            const first = parseDate(b.updated_at || b.created_at);
            const second = parseDate(a.updated_at || a.created_at);
            return first - second;
        })
);

const EMPTY_PROJECTS: Project[] = [];

/**
 * Projects for the signed-in user.
 *
 * This used to keep its own module-level cache, staleness clock, in-flight
 * dedupe and focus/visibility listeners — about 120 lines reimplementing what
 * React Query already provides, on mutable globals that needed an explicit
 * clearProjectCache to stop one user's list leaking to the next.
 *
 * Keying the query on the user id makes that leak structurally impossible, and
 * React Query keeps the last successful data when a refetch fails, which is the
 * behaviour settleProjectRefresh was added to provide.
 */
export const useProjects = () => {
    const { isSignedIn } = useAuth();
    const { user } = useUser();
    const { toast } = useToast();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const userId = user?.id ?? null;
    const enabled = Boolean(isSignedIn && userId);

    const query = useQuery({
        queryKey: projectsQueryKey(userId ?? "anonymous"),
        queryFn: async () => {
            const response = await projectService.listProjects();
            if (!response.success) {
                throw new Error(response.error || "Failed to fetch projects");
            }
            return mapProjects(response.projects);
        },
        enabled,
        staleTime: PROJECTS_STALE_MS,
        // Overrides the app-wide default from App.tsx. The sidebar is the one
        // list where coming back to the tab should show current data.
        refetchOnWindowFocus: true,
        refetchOnMount: true,
    });

    useEffect(() => {
        if (query.error) {
            const message = query.error instanceof Error
                ? query.error.message
                : String(query.error);
            console.warn('Project refresh failed; using cached projects:', message);
        }
    }, [query.error]);

    const projects = query.data ?? EMPTY_PROJECTS;

    const refreshProjects = useCallback(async (options: RefreshOptions = {}) => {
        if (!enabled || !userId) return EMPTY_PROJECTS;

        // invalidateQueries resolves only once the refetch settles, which the
        // mutations below rely on: they navigate as soon as it returns.
        if (options.force) {
            await queryClient.invalidateQueries({
                queryKey: projectsQueryKey(userId),
            });
            return queryClient.getQueryData<Project[]>(
                projectsQueryKey(userId),
            ) ?? EMPTY_PROJECTS;
        }

        const result = await query.refetch();
        return result.data ?? EMPTY_PROJECTS;
    }, [enabled, userId, queryClient, query]);

    // Other parts of the app announce a change by dispatching this event rather
    // than importing the hook, so it stays.
    useEffect(() => {
        if (!enabled || !userId) return;
        const handleProjectUpdated = () => {
            void queryClient.invalidateQueries({
                queryKey: projectsQueryKey(userId),
            });
        };
        window.addEventListener('projectUpdated', handleProjectUpdated);
        return () => window.removeEventListener('projectUpdated', handleProjectUpdated);
    }, [enabled, userId, queryClient]);

    const isLoading = query.isLoading;

    const createNewProject = async (title: string = "Untitled Project") => {
        try {
            const response = await projectService.createProject(title);
            if (response.success && response.project) {
                useChatStore.getState().resetChat();
                await refreshProjects({ force: true, showLoading: false, dedupe: false });
                navigate(`/workspace/project?projectId=${response.project.id}`);
                return response.project;
            } else {
                toast({
                    title: "Failed to create project",
                    description: response.error || "Could not create new project",
                    variant: "destructive",
                });
                return null;
            }
        } catch (error) {
            console.error('Error creating project:', error);
            toast({
                title: "Error",
                description: "Failed to create project. Please try again.",
                variant: "destructive",
            });
            return null;
        }
    };

    const renameProject = async (id: string, newTitle: string) => {
        try {
            const response = await projectService.updateProject(id, newTitle);
            if (response.success) {
                await refreshProjects({ force: true, showLoading: false, dedupe: false });
                toast({
                    title: "Project renamed",
                    description: `Project renamed to "${newTitle}"`,
                    className: "border border-border/40 bg-background/90 backdrop-blur-md",
                });
                return true;
            } else {
                toast({
                    title: "Failed to rename project",
                    description: response.error || "Could not update project name",
                    variant: "destructive",
                });
                return false;
            }
        } catch (error) {
            console.error('Error renaming project:', error);
            toast({
                title: "Error",
                description: "Failed to rename project. Please try again.",
                variant: "destructive",
            });
            return false;
        }
    };

    const deleteProject = async (id: string) => {
        try {
            const response = await projectService.deleteProject(id);
            if (response.success) {
                await refreshProjects({ force: true, showLoading: false, dedupe: false });
                toast({
                    title: "Project deleted",
                    description: "Project has been removed",
                    variant: "destructive",
                    className: "border border-destructive/40 bg-destructive/20 backdrop-blur-md",
                });
                return true;
            } else {
                toast({
                    title: "Failed to delete project",
                    description: response.error || "Could not delete project",
                    variant: "destructive",
                });
                return false;
            }
        } catch (error) {
            console.error('Error deleting project:', error);
            toast({
                title: "Error",
                description: "Failed to delete project. Please try again.",
                variant: "destructive",
            });
            return false;
        }
    };

    const openProject = (id: string) => {
        navigate(`/workspace/project?projectId=${id}`);
    };

    return {
        projects,
        isLoading,
        refreshProjects,
        createNewProject,
        renameProject,
        deleteProject,
        openProject
    };
};
