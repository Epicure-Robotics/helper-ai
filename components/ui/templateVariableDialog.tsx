"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";

interface TemplateVariableDialogProps {
  isOpen: boolean;
  onClose: () => void;
  variables: string[];
  onSubmit: (values: Record<string, string>) => void;
  templateName: string;
}

/**
 * Dialog for prompting user to fill in template variable values
 */
export function TemplateVariableDialog({
  isOpen,
  onClose,
  variables,
  onSubmit,
  templateName,
}: TemplateVariableDialogProps) {
  // Create a dynamic schema based on the variables
  const schemaFields: Record<string, z.ZodString> = {};
  const defaultValues: Record<string, string> = {};

  variables.forEach((variable) => {
    schemaFields[variable] = z.string().min(1, `${variable} is required`);
    defaultValues[variable] = "";
  });

  const formSchema = z.object(schemaFields);

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues,
  });

  const handleSubmit = (values: Record<string, string>) => {
    onSubmit(values);
    form.reset();
    onClose();
  };

  const handleClose = () => {
    form.reset();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Fill Template Variables</DialogTitle>
          <DialogDescription>
            Template: <span className="font-medium">{templateName}</span>
            <br />
            Please fill in the following variables before inserting the template.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <div className="max-h-96 space-y-4 overflow-y-auto pr-2">
              {variables.map((variable) => (
                <FormField
                  key={variable}
                  control={form.control}
                  name={variable}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{`{${variable}}`}</code>
                        <span className="capitalize">{variable.replace(/_/g, " ")}</span>
                      </FormLabel>
                      <FormControl>
                        <Input placeholder={`Enter ${variable.replace(/_/g, " ")}...`} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </div>

            <DialogFooter>
              <Button type="button" variant="outlined" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit">Insert Template</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
