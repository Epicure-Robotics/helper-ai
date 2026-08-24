"use client";

import { Trash } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useSavingIndicator } from "@/components/hooks/useSavingIndicator";
import { SavingIndicator } from "@/components/savingIndicator";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TableCell, TableRow } from "@/components/ui/table";
import { useDebouncedCallback } from "@/components/useDebouncedCallback";
import { useSession } from "@/components/useSession";
import { type UserPresence } from "@/lib/data/user";
import { LEAD_ROUTING_ROLE_LABELS, LEAD_ROUTING_ROLE_ORDER, type LeadRoutingRole } from "@/lib/leads/inboundTriage";
import { RouterOutputs } from "@/trpc";
import { api } from "@/trpc/react";
import DeleteMemberDialog from "./deleteMemberDialog";

export const PRESENCE_DISPLAY_NAMES: Record<UserPresence, string> = {
  active: "Active",
  afk: "Away",
};

export const PERMISSIONS_DISPLAY_NAMES: Record<string, string> = {
  member: "Member",
  admin: "Admin",
};

interface TeamMember {
  id: string;
  displayName: string;
  email: string | undefined;
  role: UserPresence;
  keywords: string[];
  routingRoles: LeadRoutingRole[];
  permissions: string;
  emailOnAssignment: boolean;
}

type TeamMemberRowProps = {
  member: TeamMember;
  isAdmin: boolean;
};

const updateMember = (
  data: RouterOutputs["mailbox"]["members"]["list"],
  member: TeamMember,
  updates: Partial<TeamMember>,
) => ({
  ...data,
  members: data.members.map((m) => (m.id === member.id ? { ...m, ...updates } : m)),
});

const TeamMemberRow = ({ member, isAdmin }: TeamMemberRowProps) => {
  const [presence, setPresence] = useState<UserPresence>(member.role);
  const [permissions, setPermissions] = useState<string>(member.permissions);
  const [displayNameInput, setDisplayNameInput] = useState(member.displayName || "");
  const { user: currentUser } = useSession() ?? {};

  const displayNameSaving = useSavingIndicator();
  const presenceSaving = useSavingIndicator();
  const permissionsSaving = useSavingIndicator();
  const routingRolesSaving = useSavingIndicator();
  const emailOnAssignmentSaving = useSavingIndicator();

  const [emailOnAssignment, setEmailOnAssignment] = useState(member.emailOnAssignment ?? false);
  const [routingRolesLocal, setRoutingRolesLocal] = useState<LeadRoutingRole[]>(member.routingRoles ?? []);

  const utils = api.useUtils();

  useEffect(() => {
    setPresence(member.role);
    setPermissions(member.permissions);
    setDisplayNameInput(member.displayName || "");
    setEmailOnAssignment(member.emailOnAssignment ?? false);
    setRoutingRolesLocal(member.routingRoles ?? []);
  }, [member.role, member.permissions, member.displayName, member.emailOnAssignment, member.routingRoles]);

  const { data: count } = api.mailbox.conversations.count.useQuery({
    assignee: [member.id],
  });

  const { mutate: updateDisplayName } = api.mailbox.members.update.useMutation({
    onSuccess: (data) => {
      utils.mailbox.members.list.setData(undefined, (oldData) => {
        if (!oldData) return oldData;
        return updateMember(oldData, member, { displayName: data.user?.displayName ?? "" });
      });
      displayNameSaving.setState("saved");
    },
    onError: (error) => {
      displayNameSaving.setState("error");
      toast.error("Failed to update display name", { description: error.message });
      setDisplayNameInput(member.displayName || "");
    },
  });

  const { mutate: updatePresence } = api.mailbox.members.update.useMutation({
    onSuccess: (data) => {
      utils.mailbox.members.list.setData(undefined, (oldData) => {
        if (!oldData) return oldData;
        return updateMember(oldData, member, {
          role: data.user?.role ?? member.role,
        });
      });
      presenceSaving.setState("saved");
    },
    onError: (error) => {
      presenceSaving.setState("error");
      toast.error("Failed to update status", { description: error.message });
      setPresence(member.role);
    },
  });

  const { mutate: updateRoutingRolesMut } = api.mailbox.members.update.useMutation({
    onSuccess: (data) => {
      utils.mailbox.members.list.setData(undefined, (oldData) => {
        if (!oldData) return oldData;
        return updateMember(oldData, member, { routingRoles: data.user?.routingRoles ?? [] });
      });
      routingRolesSaving.setState("saved");
    },
    onError: (error) => {
      routingRolesSaving.setState("error");
      toast.error("Failed to update inbox categories", { description: error.message });
      setRoutingRolesLocal(member.routingRoles ?? []);
    },
  });

  const { mutate: updatePermissions } = api.mailbox.members.update.useMutation({
    onSuccess: (data) => {
      utils.mailbox.members.list.setData(undefined, (oldData) => {
        if (!oldData) return oldData;
        return updateMember(oldData, member, { permissions: data.user.permissions });
      });
      permissionsSaving.setState("saved");
    },
    onError: (error) => {
      permissionsSaving.setState("error");
      toast.error("Failed to update permissions", { description: error.message });
      setPermissions(member.permissions);
    },
  });

  const { mutate: updateEmailOnAssignment } = api.mailbox.members.update.useMutation({
    onSuccess: (data) => {
      utils.mailbox.members.list.setData(undefined, (oldData) => {
        if (!oldData) return oldData;
        return updateMember(oldData, member, {
          emailOnAssignment: data.user?.emailOnAssignment ?? false,
        });
      });
      emailOnAssignmentSaving.setState("saved");
    },
    onError: (error) => {
      emailOnAssignmentSaving.setState("error");
      toast.error("Failed to update email preference", { description: error.message });
      setEmailOnAssignment(member.emailOnAssignment ?? false);
    },
  });

  const debouncedUpdateDisplayName = useDebouncedCallback((newDisplayName: string) => {
    displayNameSaving.setState("saving");
    updateDisplayName({
      userId: member.id,
      displayName: newDisplayName,
    });
  }, 500);

  const saveEmailOnAssignment = useDebouncedCallback(() => {
    emailOnAssignmentSaving.setState("saving");
    updateEmailOnAssignment({
      userId: member.id,
      emailOnAssignment,
    });
  }, 500);

  useEffect(() => {
    if (emailOnAssignment !== member.emailOnAssignment) {
      saveEmailOnAssignment();
    }
  }, [emailOnAssignment, member.emailOnAssignment, saveEmailOnAssignment]);

  const handlePresenceChange = (newPresence: UserPresence) => {
    setPresence(newPresence);
    presenceSaving.setState("saving");
    updatePresence({
      userId: member.id,
      role: newPresence,
    });
  };

  const persistRoutingRoles = (next: LeadRoutingRole[]) => {
    routingRolesSaving.setState("saving");
    updateRoutingRolesMut({
      userId: member.id,
      routingRoles: next,
    });
  };

  const toggleRoutingRole = (r: LeadRoutingRole) => {
    const set = new Set(routingRolesLocal);
    if (set.has(r)) set.delete(r);
    else set.add(r);
    const ordered = LEAD_ROUTING_ROLE_ORDER.filter((x) => set.has(x));
    setRoutingRolesLocal(ordered);
    persistRoutingRoles(ordered);
  };

  const handlePermissionsChange = (newPermissions: string) => {
    setPermissions(newPermissions);
    permissionsSaving.setState("saving");
    updatePermissions({
      userId: member.id,
      permissions: newPermissions,
    });
  };

  const handleDisplayNameChange = (value: string) => {
    setDisplayNameInput(value);
    debouncedUpdateDisplayName(value);
  };

  const getAvatarFallback = (memberRow: TeamMember): string => {
    if (memberRow.displayName?.trim()) {
      return memberRow.displayName;
    }

    if (memberRow.email) {
      const emailUsername = memberRow.email.split("@")[0];
      return emailUsername || memberRow.email;
    }

    return "?";
  };

  const isMemberAdmin = member.permissions === "admin";

  const readOnlyCategoriesLabel = () => {
    if (member.permissions === "admin") return "All categories (admin)";
    if (!member.routingRoles?.length) return "—";
    return member.routingRoles.map((r) => LEAD_ROUTING_ROLE_LABELS[r]).join(", ");
  };

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar fallback={getAvatarFallback(member)} size="sm" />
          <span className="truncate">{member.email || "No email"}</span>
        </div>
      </TableCell>
      <TableCell>
        {isAdmin || member.id === currentUser?.id ? (
          <Input
            value={displayNameInput}
            onChange={(e) => handleDisplayNameChange(e.target.value)}
            placeholder="Enter display name"
            className="w-full max-w-lg"
          />
        ) : (
          <span>{member.displayName || "No display name"}</span>
        )}
      </TableCell>
      <TableCell>
        {isAdmin ? (
          <Select value={permissions} onValueChange={handlePermissionsChange}>
            <SelectTrigger className="w-[100px]">
              <SelectValue placeholder="Permissions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="member">{PERMISSIONS_DISPLAY_NAMES.member}</SelectItem>
              <SelectItem value="admin">{PERMISSIONS_DISPLAY_NAMES.admin}</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <span>{PERMISSIONS_DISPLAY_NAMES[member.permissions]}</span>
        )}
      </TableCell>
      <TableCell>
        {isAdmin ? (
          <Select value={presence} onValueChange={(v) => handlePresenceChange(v as UserPresence)}>
            <SelectTrigger className="w-[110px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">{PRESENCE_DISPLAY_NAMES.active}</SelectItem>
              <SelectItem value="afk">{PRESENCE_DISPLAY_NAMES.afk}</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <span>{PRESENCE_DISPLAY_NAMES[member.role]}</span>
        )}
      </TableCell>
      <TableCell className="min-w-[260px] max-w-[320px]">
        {isAdmin && !isMemberAdmin ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outlined" size="sm" className="w-full justify-start text-left font-normal">
                {routingRolesLocal.length > 0
                  ? `${routingRolesLocal.length} categor${routingRolesLocal.length === 1 ? "y" : "ies"}`
                  : "Choose categories…"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80" align="start">
              <p className="text-muted-foreground mb-3 text-xs">
                Inbound triage routes tickets here by category. Pick one or more.
              </p>
              <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
                {LEAD_ROUTING_ROLE_ORDER.map((r) => (
                  <label key={r} className="flex cursor-pointer items-start gap-2 text-sm">
                    <Checkbox checked={routingRolesLocal.includes(r)} onCheckedChange={() => toggleRoutingRole(r)} />
                    <span>{LEAD_ROUTING_ROLE_LABELS[r]}</span>
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        ) : (
          <span className="text-muted-foreground text-sm">{readOnlyCategoriesLabel()}</span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Switch
            aria-label={`Email ${member.email ?? "this member"} on assignment`}
            checked={emailOnAssignment}
            onCheckedChange={setEmailOnAssignment}
            disabled={!isAdmin}
          />
          <SavingIndicator state={emailOnAssignmentSaving.state} />
        </div>
      </TableCell>
      <TableCell>
        {currentUser?.id !== member.id && isAdmin && (
          <DeleteMemberDialog
            member={{ id: member.id, displayName: member.displayName }}
            description={
              count?.total && count?.total > 0
                ? `You are about to remove ${member.displayName || member.email}. This member currently has ${count?.total} conversations assigned to them. Please reassign the tickets before deleting the member.`
                : `Are you sure you want to remove ${member.displayName || member.email}?`
            }
            assignedConversationCount={count?.total || 0}
          >
            <Button variant="ghost" size="sm" iconOnly>
              <Trash className="h-4 w-4" />
              <span className="sr-only">Delete</span>
            </Button>
          </DeleteMemberDialog>
        )}
      </TableCell>
      <TableCell className="min-w-[120px]">
        <div className="flex flex-wrap items-center gap-2">
          <SavingIndicator state={displayNameSaving.state} />
          <SavingIndicator state={permissionsSaving.state} />
          <SavingIndicator state={presenceSaving.state} />
          {isAdmin && !isMemberAdmin && <SavingIndicator state={routingRolesSaving.state} />}
        </div>
      </TableCell>
    </TableRow>
  );
};

export default TeamMemberRow;
