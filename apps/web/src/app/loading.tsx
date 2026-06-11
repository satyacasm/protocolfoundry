import { Loader } from "@/components/loader";

export default function Loading() {
  return (
    <div className="route-loading">
      <Loader label="Preparing the floor" />
    </div>
  );
}
