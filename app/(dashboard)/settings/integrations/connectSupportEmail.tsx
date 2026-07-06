import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryState } from "nuqs";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { ConfirmationDialog } from "@/components/confirmationDialog";
import LoadingSpinner from "@/components/loadingSpinner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api } from "@/trpc/react";
import SectionWrapper from "../sectionWrapper";

function gmailConnectionErrorAlert(error: string | null): ReactNode {
  if (!error) return null;

  if (error === "access_denied") {
    return (
      <Alert variant="destructive">
        <p className="font-medium">Google blocked sign-in (access denied).</p>
        <p className="mt-2 text-sm">
          If the OAuth app is still in <strong className="font-medium">Testing</strong> mode in Google Cloud Console,
          open <strong className="font-medium">APIs &amp; Services → OAuth consent screen → Test users</strong> and add
          every Google account that should connect Gmail—including the inbox you sign in with. Alternatively publish the
          app (sensitive Gmail scopes usually require verification).{" "}
          <Link className="underline font-medium" href="https://console.cloud.google.com/apis/credentials/consent">
            Open OAuth consent settings
          </Link>
          .
        </p>
      </Alert>
    );
  }

  if (error === "callback_failed") {
    return (
      <Alert variant="destructive">
        Something went wrong while finishing Gmail connection on the server. Check that{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">AUTH_URL</code> on Vercel matches this site&apos;s URL
        and that the Google client&apos;s authorized redirect URI includes{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">{"<this-site-origin>/api/connect/google/callback"}</code>
        .
      </Alert>
    );
  }

  return <Alert variant="destructive">Failed to connect Gmail. Try again or check Google Cloud OAuth settings.</Alert>;
}

const ConnectSupportEmail = () => {
  const router = useRouter();
  const [error] = useQueryState("error");
  const [detail] = useQueryState("detail");
  const utils = api.useUtils();
  const { mutateAsync: deleteSupportEmailMutation } = api.gmailSupportEmail.delete.useMutation({
    onSuccess: () => {
      toast.success("Gmail disconnected");
      void utils.gmailSupportEmail.get.invalidate();
    },
    onError: (error) => {
      toast.error("Failed to disconnect Gmail", { description: error.message });
    },
  });
  const { data: { supportAccount, enabled } = {}, isLoading } = api.gmailSupportEmail.get.useQuery();

  return (
    <SectionWrapper
      title="Support Email"
      description="Connect your support email to receive and send emails from your support email address."
    >
      {gmailConnectionErrorAlert(error)}
      {error === "callback_failed" && detail ? (
        <Alert variant="destructive" className="mt-2">
          <p className="text-xs font-mono break-all">{detail}</p>
        </Alert>
      ) : null}
      {isLoading ? (
        <LoadingSpinner size="md" />
      ) : !enabled ? (
        <Alert className="text-sm">
          Create a Google OAuth app to enable linking your Gmail account.{" "}
          <Link className="underline" href="/settings/integrations">
            See README for OAuth setup
          </Link>
        </Alert>
      ) : supportAccount ? (
        <ConfirmationDialog
          message="Are you sure you want to disconnect Gmail? You will still have access to all of your emails in Epicure Assist, but you will not be able to send/receive new emails until you connect a new Gmail account."
          onConfirm={async () => {
            await deleteSupportEmailMutation();
            router.refresh();
          }}
          confirmLabel="Yes, disconnect"
        >
          <Button variant="destructive_outlined">{`Disconnect ${supportAccount.email}`}</Button>
        </ConfirmationDialog>
      ) : (
        <>
          <Alert className="mb-4 text-sm">
            <strong className="font-medium">Deployments in Google &quot;Testing&quot;:</strong> only accounts listed as
            test users under the OAuth consent screen can connect Gmail. Others see Google error{" "}
            <code className="rounded bg-muted px-1 text-xs">403: access_denied</code>.
          </Alert>
          <Button variant="subtle" onClick={() => (location.href = `/api/connect/google`)}>
            Connect your Gmail
          </Button>
        </>
      )}
    </SectionWrapper>
  );
};

export default ConnectSupportEmail;
