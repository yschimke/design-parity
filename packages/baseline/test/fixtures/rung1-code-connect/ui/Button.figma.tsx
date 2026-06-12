import figma from "@figma/code-connect";
import { Button } from "./Button";

figma.connect(Button, "https://figma.com/file/AbC/Design?node-id=1:42", {
  example: () => <Button>Primary</Button>,
});
