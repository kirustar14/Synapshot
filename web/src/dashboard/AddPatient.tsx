// Adding a record still goes through the real create mutation and continues into the model
// inputs step, which is the only way a patient becomes measurable.

import { Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useCreatePatient } from "@/api/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

export function AddPatient() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [age, setAge] = useState("28");
  const [sex, setSex] = useState<"F" | "M">("F");
  const create = useCreatePatient();
  const navigate = useNavigate();

  const ageNumber = Number(age);
  const valid = name.trim().length > 1 && Number.isFinite(ageNumber) && ageNumber > 0 && ageNumber < 120;

  const submit = () => {
    if (!valid) return;
    create.mutate(
      { name: name.trim(), age: Math.round(ageNumber), sex },
      {
        onSuccess: (patient) => {
          setOpen(false);
          setName("");
          toast.success(`${patient.name} created as a synthetic record`);
          navigate(`/app/patients/${patient.id}/upload`);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-[#b4552f] px-3 text-[12px] font-medium text-[#fff8f3] transition-colors hover:bg-[#a04a27]"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2} aria-hidden /> Add patient
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border-[#e3ddd2] bg-[#fffdfa]">
          <DialogHeader>
            <DialogTitle className="text-[17px]">Add a synthetic patient</DialogTitle>
            <DialogDescription className="text-[12px] leading-relaxed text-[#6d675e]">
              Every record in this workspace is synthetic. The new patient has no model inputs yet, so the
              next step is the inputs form.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="dash-add-name" className="text-[12px]">
                Name
              </Label>
              <Input
                id="dash-add-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
                autoFocus
                className="border-[#e6e0d6] bg-[#fbf9f4]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dash-add-age" className="text-[12px]">
                Age
              </Label>
              <Input
                id="dash-add-age"
                inputMode="numeric"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                className="w-24 border-[#e6e0d6] bg-[#fbf9f4]"
              />
            </div>
            <fieldset className="space-y-1.5">
              <legend className="text-[12px] font-medium">Sex</legend>
              <RadioGroup value={sex} onValueChange={(v) => setSex(v as "F" | "M")} className="flex gap-4">
                <span className="flex items-center gap-2">
                  <RadioGroupItem value="F" id="dash-sex-f" />
                  <Label htmlFor="dash-sex-f" className="text-[12px] font-normal">
                    Female
                  </Label>
                </span>
                <span className="flex items-center gap-2">
                  <RadioGroupItem value="M" id="dash-sex-m" />
                  <Label htmlFor="dash-sex-m" className="text-[12px] font-normal">
                    Male
                  </Label>
                </span>
              </RadioGroup>
            </fieldset>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={!valid || create.isPending}>
              {create.isPending ? "Creating" : "Create and add inputs"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
